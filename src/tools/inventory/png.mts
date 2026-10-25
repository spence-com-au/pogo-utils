/**
 * Just enough PNG to read what `adb exec-out screencap -p` hands back and to write a crop of it back out for Tesseract.
 * A dependency would do the same, but the whole of what is needed is an 8-bit, non-interlaced image in one of the four
 * colour types a phone produces.
 *
 * It runs in a browser as well as under Node, which is why the bytes are a `Uint8Array` rather than a `Buffer` and the
 * zlib is [fflate](https://github.com/101arrowz/fflate)'s rather than `node:zlib`'s: a browser has no CRC at all, and
 * only an asynchronous `DecompressionStream` for the rest, where every reader here decodes synchronously.
 * `createImageBitmap` is no way round it either — it drops the `tEXt` chunk a stitch records its `Viewport` in, and
 * answers colour-managed pixels where `artwork.mts` picks a form by its colour.
 */

import { unzlibSync, zlibSync } from 'fflate';

/**
 * An image as four bytes a pixel, red, green, blue and alpha, row after row.
 *
 * `text` is whatever `tEXt` chunks the file carried, and is absent on an image built here rather than read — `crop` and
 * `scale` answer a new image whose own size is the truth about it. `encodePng` writes it back out, and `decodePng`
 * keeps only a chunk it could, so whatever a decode answers survives a re-encode.
 *
 * It carries a null prototype, so `Object.hasOwn(image.text ?? {}, 'Viewport')` is the question to ask about it: `in`
 * answers true for `constructor`, `toString` and every other name `Object.prototype` would have lent it.
 */
export interface Image {
  width: number;
  height: number;
  data: Uint8Array;
  text?: Readonly<Record<string, string>>;
}

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/** The CRC-32 every chunk ends with, a table of the 256 byte remainders being the usual way to it. */
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;

  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }

  return c;
});

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;

  for (const byte of bytes) {
    c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  }

  return (c ^ 0xffffffff) >>> 0;
}

const readU32 = (bytes: Uint8Array, at: number): number =>
  (((bytes[at] ?? 0) << 24) | ((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0)) >>> 0;

const writeU32 = (bytes: Uint8Array, at: number, value: number): void => {
  bytes.set([value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff], at);
};

/**
 * Latin-1 both ways, by hand: `TextDecoder('latin1')` is windows-1252 under another name, which reads `0x80`–`0x9f` as
 * curly quotes and the euro sign rather than as the code points they are.
 */
const latin1 = (bytes: Uint8Array): string => {
  let out = '';

  for (const byte of bytes) {
    out += String.fromCharCode(byte);
  }

  return out;
};

const fromLatin1 = (text: string): Uint8Array => Uint8Array.from(text, (character) => character.charCodeAt(0));

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;

  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }

  return out;
};

/** Bytes per pixel for each colour type this reads: greyscale, RGB, greyscale with alpha and RGBA. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** The most deflate can expand by: a 258-byte match coded in as few as two bits. */
const MAX_INFLATION = 1032;

/** Why a screenshot cannot be read, with where to look, since a damaged one is far likelier than a damaged codec. */
const refuse = (why: string): Error =>
  new Error(`${why} (did the screenshot fail? run \`adb exec-out screencap -p\` by hand to see)`);

/**
 * Refuses rather than guesses: a cut-off or damaged `screencap` stream would otherwise decode to an image of the right
 * size with garbage rows in it, and a scan reading those would record nonsense rather than stop.
 */
export function decodePng(bytes: Uint8Array): Image {
  if (bytes.length < 8 || SIGNATURE.some((byte, i) => bytes[i] !== byte)) {
    throw refuse('not a PNG');
  }

  let width = 0;
  let height = 0;
  let channels = 0;
  let ended = false;
  const idat: Uint8Array[] = [];

  // Null-prototype, so a file is free to carry `__proto__` as a keyword: assigning that name on a plain object reaches
  // the inherited setter and is a silent no-op, which would drop the keyword *beside* it from the same chunk.
  const text: Record<string, string> = Object.create(null);

  for (let at = 8; at < bytes.length && !ended;) {
    if (at + 12 > bytes.length || at + 12 + readU32(bytes, at) > bytes.length) {
      throw refuse('truncated PNG');
    }

    const length = readU32(bytes, at);
    const type = latin1(bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);

    if (readU32(bytes, at + 8 + length) !== crc32(bytes.subarray(at + 4, at + 8 + length))) {
      throw refuse(`corrupt PNG: the ${type} chunk fails its CRC`);
    }

    at += 12 + length;

    if (type === 'IHDR') {
      width = readU32(body, 0);
      height = readU32(body, 4);
      const [depth, colour, , , interlace] = body.subarray(8, 13);
      channels = CHANNELS[colour ?? -1] ?? 0;

      if (depth !== 8 || channels === 0 || interlace !== 0) {
        throw new Error(`unsupported PNG: bit depth ${depth}, colour type ${colour}, interlace ${interlace}`);
      }
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      ended = true;
    } else if (type === 'tEXt') {
      // Keyword, a zero byte, then the value, both Latin-1. A chunk with no separator is malformed rather than empty,
      // and is skipped, as is one `encodePng` would refuse to write back out: `tEXt` is ancillary — the lower-case `t`
      // says a decoder may ignore it — so nothing a reader needs rests on it, and refusing the whole screenshot over a
      // damaged comment would cost more than it saved.
      const split = body.indexOf(0);
      const keyword = latin1(body.subarray(0, split));
      const value = latin1(body.subarray(split + 1));

      if (split > 0 && unwritable(keyword, value) === undefined) {
        text[keyword] = value;
      }
    }
  }

  if (channels === 0) {
    throw refuse('not a PNG: there is no IHDR chunk');
  } else if (!ended) {
    throw refuse('truncated PNG');
  }

  const stride = width * channels;
  const needed = (stride + 1) * height;
  const compressed = concat(idat);

  // Sized from the IHDR, which a forger writes along with honest CRCs, so it is held to what the stream could possibly
  // hold before anything is allocated on its word. A hundred bytes declaring 30000×30000 would otherwise ask for
  // gigabytes, and a zlib bomb would have the inflate ask for them itself.
  if (needed > compressed.length * MAX_INFLATION) {
    throw refuse(
      `corrupt PNG: ${compressed.length} bytes of IDAT cannot hold the ${needed} that ${width}×${height} needs`,
    );
  }

  let raw: Uint8Array;

  try {
    // Into a buffer of exactly the size the header promised, which fflate fills without growing, so a stream that
    // inflates further than that stops there rather than allocating for the rest.
    raw = unzlibSync(compressed, { out: new Uint8Array(needed) });
  } catch (error) {
    throw refuse(`corrupt PNG: its pixels do not inflate (${error instanceof Error ? error.message : String(error)})`);
  }

  if (raw.length < needed) {
    throw refuse(`corrupt PNG: ${raw.length} bytes of pixels where ${width}×${height} needs ${needed}`);
  }

  const pixels = new Uint8Array(stride * height);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = y * stride;

    if (filter > 4) {
      throw refuse(`corrupt PNG: row ${y} has filter ${filter}`);
    }

    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? (pixels[row + x - channels] ?? 0) : 0;
      const b = y > 0 ? (pixels[row - stride + x] ?? 0) : 0;
      const c = x >= channels && y > 0 ? (pixels[row - stride + x - channels] ?? 0) : 0;
      const value = line[x] ?? 0;
      let predicted = 0;

      if (filter === 1) {
        predicted = a;
      } else if (filter === 2) {
        predicted = b;
      } else if (filter === 3) {
        predicted = (a + b) >> 1;
      } else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }

      pixels[row + x] = (value + predicted) & 0xff;
    }
  }

  // Absent rather than empty where the file carried none, so an image built here reads the same as one read from a file
  // that said nothing, and `Object.hasOwn(image.text ?? {}, 'Viewport')` is the only question a caller has to ask.
  const carried = Object.keys(text).length > 0 ? { text } : {};

  if (channels === 4) {
    return { width, height, data: pixels, ...carried };
  }

  const data = new Uint8Array(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    const src = i * channels;
    const grey = channels < 3;
    data[i * 4] = pixels[src] ?? 0;
    data[i * 4 + 1] = pixels[grey ? src : src + 1] ?? 0;
    data[i * 4 + 2] = pixels[grey ? src : src + 2] ?? 0;
    data[i * 4 + 3] = channels === 2 ? (pixels[src + 1] ?? 255) : 255;
  }

  return { width, height, data, ...carried };
}

/**
 * A keyword the spec allows: 1 to 79 characters, printable Latin-1, and no space leading, trailing or doubled.
 *
 * Checked in full rather than for length alone, because writing Latin-1 keeps the low byte of a code unit rather than
 * refusing what it cannot represent — so `Nidoran♂` would be written as `NidoranB`. A NUL is the sharpest case, being
 * the chunk's own separator: `{ 'a\0b': 'x' }` reads back as `{ a: 'b\0x' }`, written without complaint.
 */
const KEYWORD = /^[\x20-\x7e\xa1-\xff]{1,79}$/;

/**
 * A value is Latin-1 too, and holds no NUL, that being the separator the keyword is already terminated by. Spelled out
 * rather than as a character class, a range from `\x01` being a control character `no-control-regex` refuses to read.
 */
const isLatin1 = (value: string): boolean =>
  [...value].every((character) => {
    const code = character.codePointAt(0) ?? 0;

    return code > 0 && code <= 0xff;
  });

/** Why `encodePng` would refuse a chunk, or `undefined` when it would write it — and `decodePng` keeps only those. */
const unwritable = (keyword: string, value: string): string | undefined => {
  if (!KEYWORD.test(keyword)) {
    return `a tEXt keyword is 1 to 79 characters of printable Latin-1, not ${JSON.stringify(keyword)}`;
  } else if (keyword.trim() !== keyword || keyword.includes('  ')) {
    return `a tEXt keyword carries no leading, trailing or doubled space, unlike ${JSON.stringify(keyword)}`;
  } else if (!isLatin1(value)) {
    return `a tEXt value is Latin-1 with no NUL in it, unlike ${JSON.stringify(value)}`;
  }

  return undefined;
};

const text = (keyword: string, value: string): Uint8Array => {
  const refusal = unwritable(keyword, value);

  if (refusal !== undefined) {
    throw new Error(refusal);
  }

  return chunk('tEXt', fromLatin1(`${keyword}\0${value}`));
};

/**
 * `carry` is written on top of whatever `image.text` already holds, so a file's own chunks survive being decoded and
 * written back and a caller can still override one by keyword. Assigned onto a null prototype rather than spread into a
 * literal, so a `__proto__` the file carried stays a key here instead of reaching a setter.
 */
export function encodePng(image: Image, carry: Readonly<Record<string, string>> = {}): Uint8Array {
  const carried: Record<string, string> = Object.assign(Object.create(null), image.text, carry);
  const stride = image.width * 4;
  const raw = new Uint8Array((stride + 1) * image.height);

  for (let y = 0; y < image.height; y++) {
    raw.set(image.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const header = new Uint8Array(13);
  writeU32(header, 0, image.width);
  writeU32(header, 4, image.height);
  header.set([8, 6, 0, 0, 0], 8);

  return concat([
    SIGNATURE,
    chunk('IHDR', header),
    ...Object.entries(carried).map(([keyword, value]) => text(keyword, value)),
    chunk('IDAT', zlibSync(raw)),
    chunk('IEND'),
  ]);
}

function chunk(type: string, body: Uint8Array = new Uint8Array(0)): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  writeU32(out, 0, body.length);
  out.set(fromLatin1(type), 4);
  out.set(body, 8);
  writeU32(out, 8 + body.length, crc32(out.subarray(4, 8 + body.length)));

  return out;
}

/** The pixel at a point, as `[r, g, b]`. Outside the image is black rather than a throw, so a scan can overrun. */
export function rgb(image: Image, x: number, y: number): [number, number, number] {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
    return [0, 0, 0];
  }

  const i = (Math.floor(y) * image.width + Math.floor(x)) * 4;

  return [image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0];
}

/**
 * The part of a rectangle that lies inside an image, optionally inverted — white text on a sky reads badly. A
 * rectangle running off an edge is trimmed to it rather than slid back inside, and one wholly outside is an empty
 * image, so a band placed by a fraction of the screen can overrun without picking up pixels it never asked for.
 */
export function crop(image: Image, left: number, top: number, width: number, height: number, invert = false): Image {
  const x0 = Math.max(0, Math.floor(left));
  const y0 = Math.max(0, Math.floor(top));
  const w = Math.max(0, Math.min(image.width, Math.floor(left) + Math.floor(width)) - x0);
  const h = Math.max(0, Math.min(image.height, Math.floor(top) + Math.floor(height)) - y0);
  const data = new Uint8Array(w * h * 4);

  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * image.width + x0) * 4;
    data.set(image.data.subarray(src, src + w * 4), y * w * 4);
  }

  if (invert) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - (data[i] ?? 0);
      data[i + 1] = 255 - (data[i + 1] ?? 0);
      data[i + 2] = 255 - (data[i + 2] ?? 0);
    }
  }

  return { width: w, height: h, data };
}

/**
 * The screen a capture holds: the capture itself where it is one, and the first `Viewport` rows where it is a stitch.
 *
 * This is what lets a stitch be the only file committed for a detail screen. `stitch` keeps every row above the
 * scrolling band's foot from its first frame verbatim, so a stitch's top rows *are* that screen, and the crop is
 * exactly `Viewport` rows tall so every fraction of `image.height` lands where it was measured.
 *
 * Not a perfect substitute: the crop's last rows come from the *final* frame where a screen's come from the first.
 * Nothing reads there, so no region moves — what moves is Tesseract's page segmentation, which takes the whole image.
 * On two captures that costs the CP its *label* line, so `wholeCp` cannot anchor and the number arrives as a `cps`
 * candidate. Identical pixels, a different answer, because the page they sit on differs elsewhere.
 */
export const screenIn = (image: Image): Image => {
  // Matched whole rather than split and converted, `Number('')` being 0 and not `NaN`: a `Viewport` of `4x` reads as a
  // screen four wide and none tall, which `crop` answers as an empty image. A pattern says what `snap` writes and
  // nothing else, so every way of being damaged lands in the branch that hands the capture back whole.
  const stated = /^(\d+)x(\d+)$/.exec(image.text?.Viewport ?? '');

  return stated ? crop(image, 0, 0, Number(stated[1]), Number(stated[2])) : image;
};

/**
 * A nearest-neighbour enlargement. Tesseract reads small text better with more pixels under it, but only up to a
 * point: measured over twelve overlay captures, 2x turned `14/18/12` into the `14/13/12` it really was, where 3x and
 * 4x started reading the `L` of the level as a `1`.
 */
export function scale(image: Image, factor: number): Image {
  const w = image.width * factor;
  const h = image.height * factor;
  const data = new Uint8Array(w * h * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = (Math.floor(y / factor) * image.width + Math.floor(x / factor)) * 4;
      const to = (y * w + x) * 4;

      // Copied a byte at a time rather than through `subarray`, which made an array for each pixel.
      data[to] = image.data[src] ?? 0;
      data[to + 1] = image.data[src + 1] ?? 0;
      data[to + 2] = image.data[src + 2] ?? 0;
      data[to + 3] = image.data[src + 3] ?? 0;
    }
  }

  return { width: w, height: h, data };
}

/**
 * An image centred on an opaque canvas, which is what a launcher's maskable icon is. Composited rather than laid over,
 * because an anti-aliased edge carries alpha that has to meet the colour it will really sit on. Refuses a margin that
 * is not a whole pixel rather than centring the image half a pixel off.
 */
export function pad(image: Image, size: number, colour: [number, number, number]): Image {
  const margin = (size - image.width) / 2;

  if (image.width !== image.height || margin < 0 || !Number.isInteger(margin)) {
    throw new Error(`cannot centre a ${image.width}x${image.height} image in ${size}x${size}`);
  }

  const data = new Uint8Array(size * size * 4);

  for (let i = 0; i < size * size; i++) {
    data.set([colour[0], colour[1], colour[2], 255], i * 4);
  }

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const src = (y * image.width + x) * 4;
      const to = ((margin + y) * size + margin + x) * 4;
      const alpha = (image.data[src + 3] ?? 0) / 255;

      for (let c = 0; c < 3; c++) {
        data[to + c] = Math.round((image.data[src + c] ?? 0) * alpha + (colour[c] ?? 0) * (1 - alpha));
      }
    }
  }

  return { width: size, height: size, data };
}

/** How bright a pixel looks, by the Rec. 709 weights. */
export const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** How far a pixel is from grey: zero for black, white and every grey between. */
export const chroma = (r: number, g: number, b: number) => Math.max(r, g, b) - Math.min(r, g, b);

/**
 * Bright, unsaturated pixels as black on white, the pairing Tesseract reads best. Both bounds earn their place on
 * PGSharp's overlay: the luminance floor drops the dark box the text sits on, and the chroma ceiling drops the IV
 * percentage, which shares the line and is colour-coded by quality. Dropping that is the point rather than a cost, it
 * being derivable from the three IVs beside it.
 */
export function isolate(image: Image, minLuminance: number, maxChroma: number): Image {
  return threshold(image, (r, g, b) => luminance(r, g, b) >= minLuminance && chroma(r, g, b) <= maxChroma);
}

/**
 * Black where a channel reaches `min` and white elsewhere, which is `isolate` without the colour test. What that buys
 * is the thin strokes a chroma limit clips: measured on five captures, the near-white treatment reads `2/4/13` where
 * this reads `12/4/13`.
 */
export function brighten(image: Image, min: number): Image {
  return threshold(image, (r, g, b) => Math.max(r, g, b) >= min);
}

/** Black where `keep` holds for a pixel's three channels and white elsewhere, opaque throughout. */
function threshold(image: Image, keep: (r: number, g: number, b: number) => boolean): Image {
  const data = new Uint8Array(image.data.length);

  for (let i = 0; i < image.data.length; i += 4) {
    const value = keep(image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0) ? 0 : 255;

    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }

  return { width: image.width, height: image.height, data };
}

/**
 * How much of a horizontal band differs between two screenshots, as a fraction of the pixels in it. A pixel differs
 * where any of its three channels moves, blue text on a dark panel leaving red where it was.
 *
 * The band matters more than the threshold. Through one swipe the game's panel measured 31%, then 6.2%, then 0.54% and
 * stayed near it, where the artwork above never fell below 4% because the Pokémon is animated. So a caller watching
 * for a screen to stop moving watches the panel and compares against a figure between those two, not against zero.
 */
export function difference(a: Image, b: Image, from: number, to: number): number {
  if (a.width !== b.width || a.height !== b.height) {
    return 1;
  }

  const first = Math.max(0, Math.round(a.height * from));
  const last = Math.min(a.height, Math.round(a.height * to));
  const moved = (c: number): boolean => Math.abs((a.data[c] ?? 0) - (b.data[c] ?? 0)) > 8;
  let differing = 0;

  for (let y = first; y < last; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;

      if (moved(i) || moved(i + 1) || moved(i + 2)) {
        differing++;
      }
    }
  }

  return differing / Math.max(1, (last - first) * a.width);
}
