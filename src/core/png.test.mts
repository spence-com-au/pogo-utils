/**
 * What the codec does with images it builds itself, which is the whole of what a test of it needs: every function here
 * is a pure transformation of a pixel buffer.
 *
 * `encodePng` writes colour type 6 and filter 0 on every row where `decodePng` reads four colour types through four
 * filters, so a round trip exercises only the narrowest path either way. A fixture encoded elsewhere is what would
 * reach the rest, and the captures that do arrive with the readers rather than here.
 */

import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { expect, test } from 'vitest';
import {
  brighten,
  crc32 as ownCrc32,
  crop,
  decodePng,
  difference,
  encodePng,
  isolate,
  pad,
  rgb,
  scale,
  screenIn,
  type Image,
} from './png.mts';

/**
 * An image whose every pixel is a function of its position, so a transposition or an off-by-one shows up as a value.
 */
const ramp = (width: number, height: number): Image => {
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set([x * 10, y * 10, x + y, 255], (y * width + x) * 4);
    }
  }

  return { width, height, data };
};

test('an image survives being encoded and decoded byte for byte', () => {
  const image = ramp(7, 5);
  const back = decodePng(encodePng(image));

  expect([back.width, back.height]).toStrictEqual([7, 5]);
  expect([...back.data]).toStrictEqual([...image.data]);
  expect(back.text, 'a file carrying no `tEXt` reads as carrying none, not as an empty one').toBeUndefined();
});

/**
 * `screenIn` crops to the `Viewport` a stitch records and hands anything else back untouched, which is what lets one
 * file be committed where a screen and a stitch used to be.
 *
 * The untouched cases are the ones worth pinning: a capture carrying no chunk is a screen already, and a capture
 * carrying a `Viewport` that is not two numbers is damaged — cropping on either reading would answer an image of the
 * wrong size, where handing it back answers one the caller can still measure.
 */
test('`screenIn` crops to a recorded `Viewport`, and leaves anything else alone', () => {
  const image = ramp(4, 6);

  expect([screenIn(image).width, screenIn(image).height], 'no chunk, so already a screen').toStrictEqual([4, 6]);

  const carried = decodePng(encodePng(image, { Viewport: '4x2' }));
  const screen = screenIn(carried);

  expect([screen.width, screen.height]).toStrictEqual([4, 2]);
  expect([...screen.data], 'the crop is the top rows, not a resize').toStrictEqual([...crop(image, 0, 0, 4, 2).data]);

  for (const damaged of ['', '4', 'wide x tall', '4x', 'x2']) {
    const back = screenIn(decodePng(encodePng(image, { Viewport: damaged })));

    expect([back.width, back.height], `Viewport ${JSON.stringify(damaged)} was cropped to`).toStrictEqual([4, 6]);
  }
});

/**
 * A `tEXt` chunk round-trips, which is what `snap` records a stitch's `Viewport` in: a stitch is as many frames tall as
 * the screen took, so the height the phone drew is the one thing the file cannot say with its own `IHDR`.
 *
 * Asserted against `decodePng`'s own reading rather than by looking for the bytes, because what a caller depends on is
 * the keyword coming back — and the bytes are checked anyway, the chunk's CRC being verified like every other.
 */
test('a `tEXt` chunk written beside an image comes back as its keyword and value', () => {
  const back = decodePng(encodePng(ramp(3, 2), { Viewport: '1008x2244', Software: 'pogo-utils' }));

  expect({ ...back.text }).toStrictEqual({ Viewport: '1008x2244', Software: 'pogo-utils' });
  expect([...back.data], 'the chunk displaced a pixel').toStrictEqual([...ramp(3, 2).data]);
});

/**
 * And that it survives a *second* trip through the codec, `encodePng` writing `image.text` back out rather than only
 * what its caller hands it. Cropping a stitch to its viewport and saving it again is the branch's own next step, and
 * `parse` already decodes these files — so a chunk that only ever went out through `carry` would be dropped by the
 * first consumer to re-save one, silently and at exactly the moment the value is wanted.
 */
test('a `tEXt` chunk survives being decoded and encoded again', () => {
  const once = decodePng(encodePng(ramp(3, 2), { Viewport: '1008x2244' }));

  expect({ ...decodePng(encodePng(once)).text }).toStrictEqual({ Viewport: '1008x2244' });

  // And `carry` still wins, a caller correcting a keyword being the reason it is a parameter at all.
  expect({ ...decodePng(encodePng(once, { Viewport: '720x1600' })).text }).toStrictEqual({ Viewport: '720x1600' });
});

/**
 * A keyword the spec does not allow is refused when it is written rather than read back wrong. Length is the easy half.
 * The rest matter because `Buffer.from(…, 'latin1')` masks to the low byte instead of refusing: `Nidoran♂` would go to
 * the file as `NidoranB`, in a tool whose subject prints `♂`, `♀` and `✨`. A NUL is worse than lossy — it is the
 * chunk's own separator, so `{ 'a\0b': 'x' }` was written and read back as `{ a: 'b\0x' }`, a pair nobody asked for.
 */
test('a `tEXt` keyword the spec does not allow is refused rather than written lossily', () => {
  expect(() => encodePng(ramp(1, 1), { '': 'x' })).toThrow(/1 to 79 characters/);
  expect(() => encodePng(ramp(1, 1), { ['k'.repeat(80)]: 'x' })).toThrow(/1 to 79 characters/);
  expect(() => encodePng(ramp(1, 1), { ['k'.repeat(79)]: 'x' })).not.toThrow();

  expect(() => encodePng(ramp(1, 1), { 'Né♂me': 'x' }), 'masked to the low byte').toThrow(/printable Latin-1/);
  expect(() => encodePng(ramp(1, 1), { 'a\0b': 'x' }), 'moves where the value begins').toThrow(/printable Latin-1/);
  expect(() => encodePng(ramp(1, 1), { 'a\nb': 'x' })).toThrow(/printable Latin-1/);

  // Spaces the spec forbids. One *inside* a keyword is allowed, which is what makes the other three worth checking.
  expect(() => encodePng(ramp(1, 1), { ' Odd': 'x' })).toThrow(/leading, trailing or doubled space/);
  expect(() => encodePng(ramp(1, 1), { 'Odd ': 'x' })).toThrow(/leading, trailing or doubled space/);
  expect(() => encodePng(ramp(1, 1), { 'Odd  key': 'x' })).toThrow(/leading, trailing or doubled space/);
  expect(() => encodePng(ramp(1, 1), { 'Odd key': 'x' })).not.toThrow();
});

/** And the value, on the same footing: Latin-1 is what the chunk holds, and the NUL is spoken for. */
test('a `tEXt` value outside Latin-1, or carrying a NUL, is refused', () => {
  expect(() => encodePng(ramp(1, 1), { Name: 'Nidoran♂' })).toThrow(/Latin-1 with no NUL/);
  expect(() => encodePng(ramp(1, 1), { Name: 'a\0b' })).toThrow(/Latin-1 with no NUL/);
  expect(() => encodePng(ramp(1, 1), { Name: 'Nidoran\xb6' }), 'Latin-1 is written as itself').not.toThrow();
});

/**
 * A chunk `encodePng` would refuse is dropped when it is read, so every decoded image can be written back out. Built by
 * hand, because the encoder cannot write the chunks the claim is about.
 */
test('a `tEXt` chunk the encoder would refuse is dropped on decode, so the round trip holds', () => {
  const chunks = [`${'k'.repeat(80)}\0x`, 'Odd \0x', 'Odd  key\0x', 'a\nb\0x', 'Name\0a\0b', 'Ok\0y'].map((raw) => {
    const body = Buffer.from(raw, 'latin1');
    const chunk = Buffer.alloc(12 + body.length);
    chunk.writeUInt32BE(body.length, 0);
    chunk.write('tEXt', 4, 'latin1');
    body.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + body.length)), 8 + body.length);

    return chunk;
  });

  const png = encodePng(ramp(1, 1));
  const back = decodePng(Buffer.concat([png.subarray(0, 8 + 25), ...chunks, png.subarray(8 + 25)]));

  expect({ ...back.text }, 'only the keyword the encoder could write survives').toStrictEqual({ Ok: 'y' });
  expect({ ...decodePng(encodePng(back)).text }).toStrictEqual({ Ok: 'y' });
});

/**
 * That `text` carries a null prototype, so the name a caller asks about is the name the file carried and nothing else.
 * `in` would answer true for `constructor` and `toString` on every decoded image, and `__proto__` is the sharper half:
 * assigning that key on a plain object reaches the inherited setter, which is a silent no-op — so a file carrying it
 * lost the keyword *beside* it from the same read, and the image came back saying `{ Ok: 'y' }` with no sign of either.
 */
test('a `tEXt` keyword cannot be confused with a name `Object.prototype` lends', () => {
  const back = decodePng(encodePng(ramp(2, 2), { ['__proto__']: 'z', Ok: 'y' }));

  expect(Object.getPrototypeOf(back.text), '`in` would answer for `constructor` and `toString`').toBeNull();
  expect({ ...back.text }).toStrictEqual({ ['__proto__']: 'z', Ok: 'y' });
  expect(Object.hasOwn(back.text ?? {}, '__proto__')).toBe(true);
  expect(back.text?.['Ok'], 'the keyword beside `__proto__` was dropped with it').toBe('y');
});

/**
 * An unknown ancillary chunk is skipped rather than refused, which is what makes writing a `tEXt` safe to begin with:
 * the lower-case first letter of the type says a decoder may ignore it, so one it has never heard of must not stop it.
 *
 * Built by hand from a chunk the codec does not write, because the claim is about chunks it does not know — a `tEXt` it
 * now reads could not state it.
 */
test('an ancillary chunk this codec does not know is skipped rather than refused', () => {
  const png = encodePng(ramp(2, 2));
  const body = Buffer.from('whatever', 'latin1');
  const extra = Buffer.alloc(12 + body.length);
  extra.writeUInt32BE(body.length, 0);
  extra.write('mEOw', 4, 'latin1');
  body.copy(extra, 8);
  extra.writeUInt32BE(crc32(extra.subarray(4, 8 + body.length)), 8 + body.length);

  // After the signature and the 25-byte IHDR chunk, which is where a `tEXt` goes too.
  const back = decodePng(Buffer.concat([png.subarray(0, 8 + 25), extra, png.subarray(8 + 25)]));

  expect([...back.data]).toStrictEqual([...ramp(2, 2).data]);
  expect(back.text).toBeUndefined();
});

test('a zero-byte image is not a PNG, and nor is one whose signature is broken', () => {
  expect(() => decodePng(Buffer.alloc(0))).toThrow(/not a PNG/);
  expect(() => decodePng(encodePng(ramp(2, 2)).subarray(1))).toThrow(/not a PNG/);
});

/**
 * Cut through a chunk header, through the IHDR, through the IDAT and at a chunk boundary just short of IEND — the last
 * being the one only the missing IEND gives away, since every chunk before it is whole.
 */
test('a PNG cut off anywhere after its signature is refused as truncated', () => {
  const valid = encodePng(ramp(3, 3));

  for (const length of [10, 20, 40, valid.length - 13, valid.length - 12, valid.length - 1]) {
    expect(() => decodePng(valid.subarray(0, length)), `cut at ${length}`).toThrow(/truncated PNG/);
  }
});

test('a PNG with no IHDR chunk is refused rather than read as an empty image', () => {
  // The IHDR is the 25 bytes after the signature: length, type, 13 bytes of header and a CRC.
  const valid = encodePng(ramp(2, 2));

  expect(() => decodePng(Buffer.concat([valid.subarray(0, 8), valid.subarray(33)]))).toThrow(/no IHDR/);
});

test('a byte damaged inside a chunk is caught by its CRC', () => {
  const bytes = Buffer.from(encodePng(ramp(2, 2)));
  bytes[45] = (bytes[45] ?? 0) ^ 0xff;

  expect(() => decodePng(bytes)).toThrow(/IDAT chunk fails its CRC/);
});

/** A 2×2 PNG around `body` as its IDAT, with honest CRCs, so only the stream itself is wrong. */
const withIdat = (body: Buffer): Buffer => {
  const valid = encodePng(ramp(2, 2));
  const idat = Buffer.alloc(12 + body.length);
  idat.writeUInt32BE(body.length, 0);
  idat.write('IDAT', 4, 'latin1');
  body.copy(idat, 8);
  idat.writeUInt32BE(crc32(idat.subarray(4, 8 + body.length)), 8 + body.length);

  return Buffer.concat([valid.subarray(0, 33), idat, valid.subarray(-12)]);
};

/** The same around `raw` as its inflated pixel stream. */
const withPixels = (raw: number[]): Buffer => withIdat(deflateSync(Buffer.from(raw)));

test('a pixel stream that is short or names an unknown filter is refused rather than filled in', () => {
  const row = (filter: number) => [filter, ...new Array<number>(8).fill(128)];

  expect(decodePng(withPixels([...row(0), ...row(4)])).data, 'the helper builds a readable PNG').toHaveLength(16);
  expect(() => decodePng(withPixels(row(0)))).toThrow(/9 bytes of pixels where 2×2 needs 18/);
  expect(() => decodePng(withPixels([...row(0), ...row(5)]))).toThrow(/row 1 has filter 5/);
});

/**
 * A zlib stream cut off within its first six bytes holds no deflate data, which fflate answers by handing back the
 * buffer it was given, zero-filled and full length, rather than refusing. So each of these would read as sixteen zeros.
 */
test('a pixel stream with nothing inside its zlib framing is refused rather than read as a blank image', () => {
  const stream = deflateSync(Buffer.alloc(18, 128));

  for (const length of [2, 3, 4, 5, 6]) {
    expect(() => decodePng(withIdat(stream.subarray(0, length))), `cut at ${length}`).toThrow(
      /bytes of IDAT cannot hold the 18 that 2×2 needs/,
    );
  }
});

/**
 * The header's dimensions are held to what its pixel stream could hold before anything is allocated on them, and the
 * stream is inflated no further than they need, so neither a forged `IHDR` nor a zlib bomb can exhaust memory. Both
 * carry honest CRCs, which a forger computes as readily as `screencap` does.
 */
test('dimensions the pixel stream cannot fill are refused before anything is allocated for them', () => {
  const bytes = Buffer.from(encodePng(ramp(2, 2)));
  bytes.writeUInt32BE(30000, 16);
  bytes.writeUInt32BE(30000, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);

  expect(() => decodePng(bytes)).toThrow(/bytes of IDAT cannot hold the 3600030000 that 30000×30000 needs/);
});

test('a pixel stream that inflates past what the header needs is read only as far as that', () => {
  const bomb = withPixels(new Array<number>(64 * 1024 * 1024).fill(0));

  expect(bomb.length, 'the stream really is a bomb').toBeLessThan(128 * 1024);
  expect([...decodePng(bomb).data]).toStrictEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

/**
 * The header is checked before the pixels, so an image this cannot read is refused rather than mis-read. Written by
 * hand because `encodePng` emits 8-bit RGBA and nothing else, so there is no way to produce one of these from it.
 */
test('a bit depth or an interlace this does not read is refused by name', () => {
  const valid = encodePng(ramp(2, 2));

  for (const [offset, value, what] of [
    [24, 16, 'bit depth 16'],
    [25, 3, 'colour type 3'],
    [28, 1, 'interlace 1'],
  ] as [number, number, string][]) {
    const bytes = Buffer.from(valid);
    bytes[offset] = value;
    bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);

    expect(() => decodePng(bytes), `${what} is read rather than refused`).toThrow(/unsupported PNG/);
  }
});

test('a pixel reads as its three channels, and outside the image as black', () => {
  const image = ramp(4, 3);

  expect(rgb(image, 0, 0)).toStrictEqual([0, 0, 0]);
  expect(rgb(image, 3, 2)).toStrictEqual([30, 20, 5]);

  for (const [x, y] of [
    [-1, 0],
    [0, -1],
    [4, 0],
    [0, 3],
  ] as [number, number][]) {
    expect(rgb(image, x, y), `${x},${y} is outside the image and is not black`).toStrictEqual([0, 0, 0]);
  }
});

test('a crop takes the rectangle asked for, and clamps one that runs off the edge', () => {
  const image = ramp(6, 6);
  const middle = crop(image, 2, 1, 3, 2);

  expect([middle.width, middle.height]).toStrictEqual([3, 2]);
  expect(rgb(middle, 0, 0)).toStrictEqual(rgb(image, 2, 1));
  expect(rgb(middle, 2, 1)).toStrictEqual(rgb(image, 4, 2));

  // A scan sweeping bands runs off the bottom by design, so this clamps rather than throwing.
  const over = crop(image, 4, 4, 10, 10);
  expect([over.width, over.height]).toStrictEqual([2, 2]);
  expect(rgb(over, 0, 0)).toStrictEqual(rgb(image, 4, 4));
});

test('a crop off the top or left edge is trimmed rather than slid back inside', () => {
  const image = ramp(6, 6);
  const corner = crop(image, -2, -1, 3, 3);

  expect([corner.width, corner.height], 'only column 0 and rows 0–1 overlap').toStrictEqual([1, 2]);
  expect(rgb(corner, 0, 0)).toStrictEqual(rgb(image, 0, 0));
  expect(rgb(corner, 0, 1)).toStrictEqual(rgb(image, 0, 1));
});

test('a crop wholly outside the image is empty, rather than the pixels of the next row', () => {
  const image = ramp(4, 2);

  for (const [left, top] of [
    [4, 0],
    [5, 0],
    [0, 2],
    [-3, 0],
  ] as [number, number][]) {
    const outside = crop(image, left, top, 2, 1);

    expect(outside.width * outside.height, `${left},${top} overlaps nothing and is not empty`).toBe(0);
    expect(outside.data).toHaveLength(0);
  }
});

test('an inverted crop is the same rectangle with every channel turned round', () => {
  const image = ramp(4, 4);
  const plain = crop(image, 0, 0, 2, 2);
  const inverted = crop(image, 0, 0, 2, 2, true);

  expect([inverted.width, inverted.height]).toStrictEqual([2, 2]);

  for (const [x, y] of [
    [0, 0],
    [1, 1],
  ] as [number, number][]) {
    expect(rgb(inverted, x, y)).toStrictEqual(rgb(plain, x, y).map((c) => 255 - c));
  }
});

test('a scale repeats each pixel, nearest neighbour and no blending', () => {
  const image = ramp(3, 2);
  const bigger = scale(image, 2);

  expect([bigger.width, bigger.height]).toStrictEqual([6, 4]);

  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 6; x++) {
      expect(rgb(bigger, x, y), `${x},${y} is not the pixel it was enlarged from`).toStrictEqual(
        rgb(image, Math.floor(x / 2), Math.floor(y / 2)),
      );
    }
  }
});

/**
 * The two halves of `pad`: where the image lands, and what becomes of the alpha it brings. A maskable icon's plate has
 * to show through a wholly transparent pixel exactly and through a half-transparent one proportionally, because every
 * edge of the ball a launcher crops is an anti-aliased one.
 */
test('padding centres an image on an opaque plate and composites its alpha onto it', () => {
  const quarters = new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 128, 255, 255, 255, 255]);
  const padded = pad({ width: 2, height: 2, data: quarters }, 4, [8, 16, 24]);

  expect([padded.width, padded.height]).toStrictEqual([4, 4]);
  expect([...padded.data].filter((_, i) => i % 4 === 3)).toStrictEqual(Array<number>(16).fill(255));
  expect(rgb(padded, 0, 0)).toStrictEqual([8, 16, 24]);

  // The image's own four pixels, one in from each edge: opaque, wholly transparent, half-transparent and opaque again.
  expect(rgb(padded, 1, 1)).toStrictEqual([255, 0, 0]);
  expect(rgb(padded, 2, 1)).toStrictEqual([8, 16, 24]);
  expect(rgb(padded, 1, 2)).toStrictEqual([4, 8, 140]);
  expect(rgb(padded, 2, 2)).toStrictEqual([255, 255, 255]);
});

test('an image that cannot be centred on a whole pixel is refused rather than placed half a pixel off', () => {
  expect(() => pad(ramp(3, 3), 4, [0, 0, 0])).toThrow(/cannot centre a 3x3 image in 4x4/);
  expect(() => pad(ramp(5, 5), 4, [0, 0, 0])).toThrow(/cannot centre/);
  expect(() => pad(ramp(2, 3), 4, [0, 0, 0])).toThrow(/cannot centre/);
});

/**
 * Both bounds of `isolate`, which is what the overlay needs and what a plain luminance threshold cannot give: the floor
 * drops the dark box the text sits on, and the ceiling drops the IV percentage, which is coloured by how good the
 * Pokémon is. Black is the ink here and white the page, which is the pairing Tesseract reads best.
 */
test('isolate keeps a pixel only where it is both bright enough and grey enough', () => {
  // Cyan rather than the magenta the overlay draws at 93, because magenta's luminance is 72.6 and so fails the floor
  // before the ceiling is ever reached — an assertion that would pass with the colour test deleted. Cyan is 200.8,
  // which is the IV percentage at 86 and the one that genuinely needs the chroma half.
  const pixels: [number, number, number][] = [
    [255, 255, 255],
    [40, 40, 40],
    [0, 255, 255],
  ];
  const data = new Uint8Array(pixels.length * 4);
  pixels.forEach((p, i) => data.set([...p, 255], i * 4));

  const out = isolate({ width: pixels.length, height: 1, data }, 150, 55);

  expect(rgb(out, 0, 0), 'white is bright and grey, so it is ink').toStrictEqual([0, 0, 0]);
  expect(rgb(out, 1, 0), 'dark grey fails the luminance floor').toStrictEqual([255, 255, 255]);
  expect(rgb(out, 2, 0), 'cyan is bright enough and fails the chroma ceiling').toStrictEqual([255, 255, 255]);
});

test('brighten is the same test without the colour half, so it keeps what isolate drops', () => {
  // The same cyan, which is the pair of tests saying something neither says alone: `isolate` deletes it for being
  // coloured and `brighten` keeps it for being bright, which is why the overlay is read both ways. Cyan rather than
  // magenta because the brightest channel has to be one that is **not** red — against a red-only test magenta's 255
  // passes either way, and the thing being asserted is that all three channels are looked at.
  const data = new Uint8Array(8);
  data.set([0, 255, 255, 255], 0);
  data.set([40, 40, 40, 255], 4);

  const out = brighten({ width: 2, height: 1, data }, 150);

  expect(rgb(out, 0, 0), 'cyan reaches the floor on its brightest channel').toStrictEqual([0, 0, 0]);
  expect(rgb(out, 1, 0)).toStrictEqual([255, 255, 255]);
});

/**
 * The band is what `difference` is about rather than the threshold: a caller watches the game's own panel for a screen
 * to settle, because the artwork above it holds an animated Pokémon that never stops and the status bar ticks with the
 * clock. So a change outside the band has to read as no change at all.
 */
test('difference answers over the band it is given and ignores the rest of the frame', () => {
  const a = ramp(10, 10);
  const b = { ...a, data: new Uint8Array(a.data) };

  for (let x = 0; x < 10; x++) {
    b.data[(2 * 10 + x) * 4] = 255;
  }

  expect(difference(a, b, 0.2, 0.3), 'the whole of this band is the row that changed').toBe(1);
  expect(difference(a, b, 0.5, 1), 'the row that changed is not in this band').toBe(0);
  expect(difference(a, b, 0, 1), 'one row of ten').toBeCloseTo(0.1, 10);
  expect(difference(a, a, 0, 1), 'a frame against itself').toBe(0);
});

test('a pixel differs where any channel moves, not only red', () => {
  // (0,1,2) to (0,255,255) is dark to cyan with red untouched: blue or cyan text appearing on a dark panel.
  const a = { width: 1, height: 1, data: new Uint8Array([0, 1, 2, 255]) };

  for (const changed of [
    [0, 255, 2],
    [0, 1, 255],
    [0, 255, 255],
  ]) {
    const b = { width: 1, height: 1, data: new Uint8Array([...changed, 255]) };

    expect(difference(a, b, 0, 1), `(0,1,2) to (${changed.join(',')})`).toBe(1);
  }
});

test('two images of different sizes differ completely rather than throwing', () => {
  expect(difference(ramp(4, 4), ramp(5, 4), 0, 1)).toBe(1);
});

/**
 * The CRC and the zlib stream are this file's own and fflate's rather than Node's, so a browser can run them. Held to
 * Node's here, which is what every PNG on disk was written with: a CRC that disagreed would refuse every one of them.
 */
test('the CRC is the one Node computes, and what is deflated Node inflates', () => {
  for (const bytes of [
    new Uint8Array(0),
    new TextEncoder().encode('IEND'),
    new Uint8Array(4096).map((_, i) => i * 7),
  ]) {
    expect(ownCrc32(bytes), `${bytes.length} bytes`).toBe(crc32(bytes));
  }

  const image = ramp(5, 3);
  const png = encodePng(image);

  // The signature and IHDR, then IDAT's length and type ahead of its data, and its CRC and IEND after.
  const idat = png.subarray(8 + 25 + 8, png.length - 4 - 12);

  expect(Uint8Array.from(inflateSync(idat)).length, 'the pixel stream is not one Node inflates').toBe((5 * 4 + 1) * 3);
});
