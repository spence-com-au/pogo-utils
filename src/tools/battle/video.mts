/**
 * The whole of a run's screen kept as video, out of the very H.264 `feed` decodes: each recording's bytes are cut into
 * pictures as they arrive, stamped with when they did, and written as MPEG-TS, which carries a time for each picture
 * where raw H.264 carries none. `screenrecord` sends a picture only when the screen changes, so a still screen is one
 * picture held, not thirty a second, and only the stamps put the next one where it belongs.
 *
 * A picture's time is when it arrived, in milliseconds since `origin` — the run's start, which the log is timed from —
 * so a moment the log names is that moment in the video. The very first picture is shown from 0, there being nothing
 * earlier to show. One recording overlaps the next by however long the hand-over takes, and the video goes over to the
 * next from `HELD_MS` before its first byte, about the moment its first picture shows, so nothing is shown twice.
 */

import { Pictures, type Picture } from './pictures.mts';
import { type Recording } from './stream.mts';

/** The packet ids: the program map's, and the video's, which carries the clock too. */
const PMT_PID = 0x1000;
const VIDEO_PID = 0x100;

/** MPEG-TS's 90kHz, against the milliseconds pictures are stamped in. */
const TICKS_PER_MS = 90;

/**
 * How far each picture is shown after the clock reaches it, the decoder's time to have it. A player starts at the first
 * picture's time, so this moves nothing in what it shows.
 */
const DELAY_MS = 100;

/**
 * How long before its first byte the next recording's first picture shows the screen. `screenrecord` holds its first
 * pictures while it starts and then sends them in a rush, so the first shows what the last recording sent 38–98ms (a
 * median of 63ms) earlier, across 14 hand-overs on a Pixel 4 XL. Cutting the last recording this far back means none
 * of that is shown twice, at the cost of the odd frame where the next was quicker.
 */
export const HELD_MS = 100;

const AUD = Uint8Array.of(0, 0, 0, 1, 9, 0xf0);

/** MPEG-2's CRC-32, which closes each table: unreflected, from all ones, with no final inversion. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc ^= byte << 24;

    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
    }
  }

  return crc >>> 0;
}

/**
 * A 33-bit time over five bytes, PES-style, after a four-bit `prefix`. Divided rather than shifted, since a time past
 * 2³¹ ticks — 6.6 hours — would lose its top bits to JavaScript's 32-bit shifts.
 */
function timestamp(prefix: number, ticks: number): number[] {
  const high = Math.floor(ticks / 2 ** 30) & 0x7;
  const middle = Math.floor(ticks / 2 ** 15) & 0x7fff;
  const low = ticks & 0x7fff;

  return [(prefix << 4) | (high << 1) | 1, middle >> 7, ((middle & 0x7f) << 1) | 1, low >> 7, ((low & 0x7f) << 1) | 1];
}

/** The six bytes of a program clock reference, its 33-bit base in 90kHz ticks and no extension. */
function pcr(ticks: number): number[] {
  return [
    Math.floor(ticks / 2 ** 25) & 0xff,
    (ticks >>> 17) & 0xff,
    (ticks >>> 9) & 0xff,
    (ticks >>> 1) & 0xff,
    ((ticks & 1) << 7) | 0x7e,
    0,
  ];
}

/**
 * The MPEG-TS a run's video is written as, one `write` of whole packets for each picture so that a run stopped at any
 * point leaves a file that plays to there. The tables go ahead of every key picture, which a player may start from.
 */
class TransportStream {
  readonly #write: (bytes: Uint8Array) => void;
  readonly #counters = new Map<number, number>();

  constructor(write: (bytes: Uint8Array) => void) {
    this.#write = write;
  }

  picture(bytes: Uint8Array, ms: number, key: boolean): void {
    const ticks = Math.round(ms * TICKS_PER_MS);
    const pts = ticks + DELAY_MS * TICKS_PER_MS;
    const header = [0, 0, 1, 0xe0, 0, 0, 0x80, 0x80, 5, ...timestamp(0x2, pts)];

    // A picture in a transport stream opens with an access unit delimiter, which `screenrecord` does not send.
    const delimited = ((bytes[bytes[2] === 1 ? 3 : 4] ?? 0) & 0x1f) === 9;
    const lead = delimited ? new Uint8Array(0) : AUD;
    const pes = new Uint8Array(header.length + lead.length + bytes.length);
    pes.set(header);
    pes.set(lead, header.length);
    pes.set(bytes, header.length + lead.length);

    const packets: Uint8Array[] = key ? [this.#table(0, this.#pat()), this.#table(PMT_PID, this.#pmt())] : [];

    for (let at = 0; at < pes.length;) {
      const first = at === 0;
      const room = 184 - (first ? 8 : 0);
      const take = Math.min(room, pes.length - at);
      packets.push(this.#packet(VIDEO_PID, first, pes.subarray(at, at + take), first ? ticks : undefined));
      at += take;
    }

    const out = new Uint8Array(packets.length * 188);
    packets.forEach((packet, i) => out.set(packet, i * 188));
    this.#write(out);
  }

  /** One 188-byte packet, the adaptation field holding the clock where one is given and stuffing what is left. */
  #packet(pid: number, start: boolean, payload: Uint8Array, clock?: number): Uint8Array {
    const packet = new Uint8Array(188).fill(0xff);
    const counter = this.#counters.get(pid) ?? 0;
    this.#counters.set(pid, (counter + 1) & 0xf);

    const fields = clock === undefined ? [] : [0x10, ...pcr(clock)];
    const stuffing = 184 - payload.length - (fields.length > 0 ? fields.length + 1 : 0);
    const adaptation = fields.length > 0 || stuffing > 0;

    packet[0] = 0x47;
    packet[1] = (start ? 0x40 : 0) | ((pid >> 8) & 0x1f);
    packet[2] = pid & 0xff;
    packet[3] = (adaptation ? 0x30 : 0x10) | counter;

    if (adaptation) {
      // The field's length byte, then its flags — or, where one byte of stuffing is all that is needed, the length alone.
      // What follows them is stuffing, left as the `ff` the packet was filled with.
      const length = fields.length > 0 ? fields.length + stuffing : stuffing - 1;
      packet[4] = length;

      if (fields.length > 0) {
        packet.set(fields, 5);
      } else if (length > 0) {
        packet[5] = 0;
      }
    }

    packet.set(payload, 188 - payload.length);

    return packet;
  }

  /** A table as the one packet it fits in, after its pointer field, closed by its CRC. */
  #table(pid: number, section: number[]): Uint8Array {
    const crc = crc32(Uint8Array.from(section));
    const payload = new Uint8Array(184).fill(0xff);
    payload.set([0, ...section, crc >>> 24, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff]);

    return this.#packet(pid, true, payload);
  }

  /** The program association table: one program, whose map is at `PMT_PID`. */
  #pat(): number[] {
    return [0x00, 0xb0, 13, 0, 1, 0xc1, 0, 0, 0, 1, 0xe0 | (PMT_PID >> 8), PMT_PID & 0xff];
  }

  /** The program map: one H.264 stream, which carries the clock. */
  #pmt(): number[] {
    const video = [0xe0 | (VIDEO_PID >> 8), VIDEO_PID & 0xff];

    return [0x02, 0xb0, 18, 0, 1, 0xc1, 0, 0, ...video, 0xf0, 0, 0x1b, ...video, 0xf0, 0];
  }
}

/** One recording's pictures, held until the video has gone over to it, and when its first byte came. */
interface Segment {
  pictures: Picture[];
  first?: number;
  ended: boolean;
}

/**
 * A run's screen as one video, out of each recording `watch` is handed in the order they start. A recording's pictures
 * go out until `HELD_MS` before the next recording's first byte, and the next's once the last has sent a picture from
 * there on or has ended, held until then. Since that first byte can come at any moment, each picture is written only
 * once `HELD_MS` have gone by since it came, or a cut is known, or the video is closed.
 */
export class Video {
  readonly #stream: TransportStream;
  readonly #origin: number;
  readonly #now: () => number;
  readonly #segments: Segment[] = [];
  readonly #cutters: Pictures[] = [];

  /** The segment being written from. */
  #writing = 0;
  #last: number | undefined;
  #closed = false;

  /**
   * Writes the pictures still held once they come due, when no picture or recording's end comes along to write them.
   */
  #due: NodeJS.Timeout | undefined;

  /** `write` takes whole packets, `origin` is when the run began and `now` the clock it began by. */
  constructor(write: (bytes: Uint8Array) => void, origin: number, now = () => performance.now()) {
    this.#stream = new TransportStream(write);
    this.#origin = origin;
    this.#now = now;
  }

  /**
   * Keeps what `recording` sends, and hands it back for `feed` to decode. Heard beside the pipe into `ffmpeg` that
   * `decodeFrames` sets up, which must be in place before this turn of the event loop ends: a stream flowing to a
   * listener alone drops what the pipe would have had.
   */
  watch(recording: Recording): Recording {
    const segment: Segment = { pictures: [], ended: false };
    const index = this.#segments.length;
    const cutter = new Pictures((picture) => {
      // One the video has gone on from is still sending for as long as its kill takes, and none of it is wanted.
      if (index < this.#writing) {
        return;
      }

      segment.pictures.push(picture);
      this.#pump();
    });

    this.#segments.push(segment);
    this.#cutters.push(cutter);

    // The cut is measured from the next recording's first byte, the parameter sets `screenrecord` leads with, rather
    // than from its first picture being whole, which comes a picture later and later still in the rush it starts with.
    recording.stdout.on('data', (chunk: Buffer) => {
      if (!this.#closed) {
        const at = this.#now() - this.#origin;
        segment.first ??= at;
        cutter.push(chunk, at);
      }
    });

    recording.stdout.once('close', () => {
      if (!this.#closed) {
        cutter.end();
        segment.ended = true;
        this.#pump();
      }
    });

    return recording;
  }

  /** Writes what is left, the picture each recording still has open included, and takes no more. */
  close(): void {
    if (this.#closed) {
      return;
    }

    for (const [i, cutter] of this.#cutters.entries()) {
      cutter.end();
      const segment = this.#segments[i];

      if (segment) {
        segment.ended = true;
      }
    }

    this.#closed = true;
    clearTimeout(this.#due);
    this.#pump();
  }

  #pump(): void {
    for (;;) {
      const segment = this.#segments[this.#writing];

      if (!segment) {
        return;
      }

      const later = this.#segments.slice(this.#writing + 1);
      const next = later.find(({ first }) => first !== undefined)?.first;
      const cut = next === undefined ? Infinity : next - HELD_MS;

      // Until a cut is known, one could still come `HELD_MS` after now and fall before any picture since then.
      const settled = next !== undefined || this.#closed ? Infinity : this.#now() - this.#origin - HELD_MS;
      let over = false;

      for (let picture = segment.pictures[0]; picture && picture.at <= settled; picture = segment.pictures[0]) {
        segment.pictures.shift();

        if (picture.at < cut) {
          this.#emit(picture);
        } else {
          over = true;
        }
      }

      // An ended recording is gone on from once nothing of it is held: what is, a cut may yet come for, or time.
      if (!(over || (segment.ended && later.length > 0 && segment.pictures.length === 0))) {
        this.#hold(segment.pictures[0]);
        return;
      }

      this.#writing++;
    }
  }

  /**
   * Comes back for `held` once its `HELD_MS` are up, so the pictures before a screen goes still are written then rather
   * than at whatever next arrives, which a crash would never see. All but the last of them: that one is whole only once
   * the screen next changes, its recording ends or the video closes, `Pictures` having no way to tell sooner, so a crash
   * on a still screen loses it. Unreferenced, so it never keeps a run's process alive.
   */
  #hold(held: Picture | undefined): void {
    clearTimeout(this.#due);
    this.#due = undefined;

    if (held && !this.#closed) {
      const wait = Math.max(0, held.at + HELD_MS - (this.#now() - this.#origin));
      this.#due = setTimeout(() => this.#pump(), wait + 1).unref();
    }
  }

  /** A picture out, at least a millisecond after the last so that no two share a time, and the first from 0. */
  #emit({ bytes, at, key }: Picture): void {
    const ms = this.#last === undefined ? 0 : Math.max(at, this.#last + 1);
    this.#last = ms;
    this.#stream.picture(bytes, ms, key || ms === 0);
  }
}
