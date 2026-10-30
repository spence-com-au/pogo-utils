/**
 * The demo phone the battle's Worker reaches, over a recording a fifth of a second a picture, with a decoder that says
 * how many pictures it was handed in place of WebCodecs: what its screen sends and when, what a screenshot shows, and
 * that `battlePhone` comes up on it, `FakeDecoder` standing in for WebCodecs there.
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { DEMO_SERIAL } from '../phone-store.js';
import { fixture } from '../testing/fixture.js';
import { Pictures, type Picture } from '../tools/battle/pictures.mts';
import { decodePng, type Image } from '../tools/inventory/png.mts';
import { demoConnection } from './demo.js';
import { battlePhone } from './phone.js';
import { FakeChunk, FakeDecoder } from './test-phone.js';

// One key picture and 150 after it, a five-second fixture made of a recording's stream.
const CLIP = fixture(new URL('../tools/battle/fixtures/charge.h264', import.meta.url));
const FPS = 5;
const PERIOD = 1000 / FPS;

const pictures: Picture[] = [];
const cut = new Pictures((picture) => pictures.push(picture));
cut.push(CLIP, 0);
cut.end();

/** One pixel whose red is how many pictures `h264` held, as a decoder would put out the last of them. */
async function* counting(h264: ReadableStream<Uint8Array>): AsyncGenerator<Image> {
  const bytes = new Uint8Array(await new Response(h264).arrayBuffer());
  let count = 0;
  const counted = new Pictures(() => count++);
  counted.push(bytes, 0);
  counted.end();

  yield { width: 1, height: 1, data: Uint8Array.of(count, 0, 0, 255) };
}

/** What `stream` has sent so far, left to be read on. */
function reading(stream: ReadableStream<Uint8Array>) {
  const sent: Uint8Array[] = [];
  void stream.pipeTo(new WritableStream({ write: (chunk) => void sent.push(chunk) }));

  return sent;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('is the demo phone, its shell answering settings as Android does', async () => {
  const phone = demoConnection(CLIP, FPS, counting, () => Date.now());
  const text = async (command: string[]) => new TextDecoder().decode(await phone.transport.shell(command));

  expect([phone.name, phone.serial]).toEqual(['Demo phone', DEMO_SERIAL]);
  expect(await text(['settings', 'get', 'global', 'stay_on_while_plugged_in'])).toBe('0\n');

  await phone.transport.shell(['settings', 'put', 'global', 'stay_on_while_plugged_in', '7']);

  expect(await text(['settings', 'get', 'global', 'stay_on_while_plugged_in'])).toBe('7\n');
  expect(await text(['svc', 'power', 'stayon', 'usb'])).toBe('');
});

test('records from the picture showing, then each as its time comes, and round again', async () => {
  expect(pictures[0]?.key).toBe(true);
  expect(pictures.slice(1).every(({ key }) => !key)).toBe(true);

  const phone = demoConnection(CLIP, FPS, counting, () => Date.now());
  await vi.advanceTimersByTimeAsync(10.5 * PERIOD);

  const recording = await phone.spawn(['screenrecord', '--output-format=h264', '-']);
  const sent = reading(recording.stdout);
  await vi.advanceTimersByTimeAsync(0);

  // The eleventh picture is showing, which a decoder needs every picture since the key one before it to show.
  expect(sent).toEqual(pictures.slice(0, 11).map(({ bytes }) => bytes));

  await vi.advanceTimersByTimeAsync(PERIOD);

  expect(sent.at(-1)).toEqual(pictures[11]?.bytes);

  await vi.advanceTimersByTimeAsync((pictures.length - 12) * PERIOD);

  expect(sent.at(-1)).toEqual(pictures.at(-1)?.bytes);

  await vi.advanceTimersByTimeAsync(PERIOD);

  expect(sent.at(-1)).toEqual(pictures[0]?.bytes);

  recording.kill();
  const count = sent.length;
  await vi.advanceTimersByTimeAsync(10 * PERIOD);

  expect(sent).toHaveLength(count);
});

test('screenshots the picture showing, decoded from the key picture before it', async () => {
  const phone = demoConnection(CLIP, FPS, counting, () => Date.now());
  const handed = async () => decodePng(await phone.transport.screencap()).data[0];

  expect(await handed()).toBe(1);

  await vi.advanceTimersByTimeAsync(41.5 * PERIOD);

  expect(await handed()).toBe(42);

  // Round again to the key picture it opens on.
  await vi.advanceTimersByTimeAsync((pictures.length - 41) * PERIOD);

  expect(await handed()).toBe(1);
});

test('closing it ends its recordings and its connection', async () => {
  const phone = demoConnection(CLIP, FPS, counting, () => Date.now());
  const recording = await phone.spawn(['screenrecord', '-']);
  const ended = new Response(recording.stdout).arrayBuffer();

  await phone.close();

  await expect(ended).resolves.toBeInstanceOf(ArrayBuffer);
  await expect(phone.disconnected).resolves.toBeUndefined();
  await expect(phone.spawn(['input', 'tap', '1', '1'])).rejects.toThrow('the demo phone runs no input');
});

test('comes up as the phone a battle plays through', async () => {
  vi.useRealTimers();
  vi.stubGlobal('VideoDecoder', FakeDecoder);
  vi.stubGlobal('EncodedVideoChunk', FakeChunk);

  const connection = demoConnection(CLIP, FPS, counting);
  const phone = await battlePhone(connection);

  expect(phone.frame()).toBeDefined();
  await phone.tap([0.5, 0.5]);

  phone.close();
  await connection.close();
});
