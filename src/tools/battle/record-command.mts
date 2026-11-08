/**
 * What `screenrecord` is asked for, apart from the `adb` process `stream.mts` runs it in, so that a page streaming over
 * WebUSB asks for exactly the same picture: `stream.mts` reaches Node's `child_process`, and this reaches nothing. And
 * what `ffmpeg` is asked to decode it with, so that a test using `ffmpeg` in place of the page's WebCodecs decodes
 * exactly as `pnpm battle` does.
 */

import { type Size } from './layout.mts';

/**
 * A quarter of the Pixel 4 XL's 1440×3040 across, 360×760, and as tall on another phone as its shape makes it, rounded
 * to even for H.264. A size of any other shape `screenrecord` fits inside with black bars down two sides, which every
 * position measured across the frame would miss by. Colour samples need no more, and the frames `ffmpeg` hands back
 * are a quarter of what `screenrecord`'s 720×1520 would be — 33 MB a second rather than 131. The screens read by OCR
 * are still, and take a full screenshot instead.
 */
export function streamSize({ width, height }: Size): Size {
  return { width: 360, height: 2 * Math.round((180 * height) / width) };
}

/**
 * Enough for the picture at `streamSize`, against `screenrecord`'s default of 20 Mbps, which made 6 MB of four
 * seconds. Nothing here watches for detail a lower rate would blur; the cost of a higher one is USB and decoding time.
 */
const BIT_RATE = 2_000_000;

/** The longest `screenrecord` will record for, in seconds; it refuses a `--time-limit` past it. */
export const RECORD_LIMIT_S = 180;

/** `screenrecord` writing H.264 at `size` to its stdout for `seconds`, as a command for the phone's shell. */
export function recordCommand({ width, height }: Size, seconds = RECORD_LIMIT_S): string[] {
  return [
    'screenrecord',
    '--output-format=h264',
    `--size=${width}x${height}`,
    `--bit-rate=${BIT_RATE}`,
    `--time-limit=${seconds}`,
    '-',
  ];
}

/**
 * `ffmpeg` decoding H.264 from its stdin into RGBA frames at `size` on its stdout. The flags are for latency: by default
 * `ffmpeg` probes a few seconds of input before it decodes any, and frame threading holds frames back to decode them
 * side by side, either of which puts the picture behind the battle it shows. Threading is turned off twice, since
 * `-threads` before `-i` reaches only the decoder, and the `rawvideo` encoder's threading would hold each frame until
 * the next. `-fflags nobuffer` is the one that reads as if it belongs with them and does not: it dropped 28 of the
 * first 30 frames of a recording off the phone. A frame still comes out only once the next has begun, `ffmpeg` finding
 * where a picture ends from the start of the one after it.
 */
export function decodeArgs({ width, height }: Size): string[] {
  return [
    ...['-loglevel', 'error', '-flags', 'low_delay', '-probesize', '32', '-threads', '1'],
    ...['-f', 'h264', '-i', 'pipe:0'],
    ...['-threads', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, 'pipe:1'],
  ];
}
