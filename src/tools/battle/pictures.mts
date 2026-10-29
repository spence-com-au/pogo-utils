/**
 * `Pictures` on its own, apart from the MPEG-TS writer in `video.mts`, so that a browser can cut a recording into the
 * pictures WebCodecs decodes one at a time: `video.mts` reads a recording as Node's stream and pumps on an unreferenced
 * Node timer, and this reaches nothing.
 */

/** One picture: its NAL units as they came, Annex B, and when its first arrived. */
export interface Picture {
  bytes: Uint8Array;
  at: number;
  key: boolean;
}

/**
 * Cuts an H.264 stream into pictures as it arrives. A picture is known to be whole only once the next has begun, as
 * `ffmpeg` knows it, and begins at whatever opens one after the last's slices: an access unit delimiter, a parameter
 * set or SEI, or a slice whose first macroblock is the picture's first, which leaves out the further slices of one
 * picture. That first macroblock is `ue(v)` 0, a lone set bit, so it is the top bit of the byte after the NAL header.
 */
export class Pictures {
  readonly #emit: (picture: Picture) => void;
  #pending = new Uint8Array(0);
  #at = 0;
  #key = false;
  #slices = false;

  /** How far into `#pending` start codes have been looked for. */
  #scanned = 0;

  constructor(emit: (picture: Picture) => void) {
    this.#emit = emit;
  }

  push(chunk: Uint8Array, at: number): void {
    if (this.#pending.length === 0) {
      this.#at = at;
    }

    let bytes = new Uint8Array(this.#pending.length + chunk.length);
    bytes.set(this.#pending);
    bytes.set(chunk, this.#pending.length);

    // A start code is `00 00 01`, and the two bytes after it are what says whether it opens a picture.
    for (let p = this.#scanned; p + 4 < bytes.length; p++) {
      if (bytes[p] !== 0 || bytes[p + 1] !== 0 || bytes[p + 2] !== 1) {
        continue;
      }

      const type = (bytes[p + 3] ?? 0) & 0x1f;
      const slice = type === 1 || type === 5;
      const opens = slice ? ((bytes[p + 4] ?? 0) & 0x80) !== 0 : [6, 7, 8, 9].includes(type);

      if (opens && this.#slices) {
        // The zero before a four-byte start code goes with the unit it leads.
        const from = bytes[p - 1] === 0 ? p - 1 : p;
        this.#emit({ bytes: bytes.subarray(0, from), at: this.#at, key: this.#key });
        bytes = bytes.subarray(from);
        p -= from;
        this.#at = at;
        this.#key = false;
        this.#slices = false;
      }

      this.#slices ||= slice;
      this.#key ||= type === 5;
    }

    this.#pending = bytes;
    this.#scanned = Math.max(0, bytes.length - 4);
  }

  /** The picture still open, once nothing will follow it: the last before a recording ends, or a still screen's. */
  end(): void {
    if (this.#slices) {
      this.#emit({ bytes: this.#pending, at: this.#at, key: this.#key });
    }

    this.#pending = new Uint8Array(0);
    this.#scanned = 0;
    this.#key = false;
    this.#slices = false;
  }
}
