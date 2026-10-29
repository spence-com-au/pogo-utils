/**
 * The page and the battle's Worker talking over a channel as they would across the Worker's boundary, each message
 * cloned, with stand-ins for the phone over WebUSB and `FakeDecoder` for WebCodecs: who holds the phone when, what the
 * page is answered, and how a run that fails hands the phone back all the same.
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { Phone as Connection } from '../inventory/webusb.js';
import { PhoneStore } from '../phone-store.js';
import { fixture } from '../testing/fixture.js';
import { lend, type Endpoint } from './client.js';
import { host } from './host.js';
import { FakeChunk, FakeDecoder, fakeConnection } from './test-phone.js';

const H264 = fixture(new URL('../tools/battle/fixtures/charge.h264', import.meta.url));

let channel: MessageChannel;

beforeEach(() => {
  FakeDecoder.made = [];
  FakeDecoder.failing = false;
  vi.stubGlobal('VideoDecoder', FakeDecoder);
  vi.stubGlobal('EncodedVideoChunk', FakeChunk);
  channel = new MessageChannel();
});

afterEach(() => {
  vi.unstubAllGlobals();
  channel.port1.close();
  channel.port2.close();
});

/**
 * A page holding a phone and a Worker reaching it through `open`, with what each opens and lets go of told to `log` in
 * the order it happens.
 */
async function setUp(log: string[], open: (serial: string) => Promise<Connection>) {
  const store = new PhoneStore();
  const held = fakeConnection('pixel', H264, log);
  await store.hold(held.connection);

  const worker = channel.port1;
  const page = channel.port2;

  host(
    {
      postMessage: (message) => worker.postMessage(message),
      addEventListener: (type, listener) => worker.addEventListener(type, listener as EventListener),
    },
    (serial) => {
      log.push(`worker opened ${serial}`);
      return open(serial);
    },
  );

  const endpoint: Endpoint = {
    postMessage: (command) => page.postMessage(command),
    addEventListener: (type: string, listener: (event: never) => void) =>
      page.addEventListener(type, listener as EventListener),
    terminate: () => log.push('worker ended'),
  };

  worker.start();
  page.start();

  const back = fakeConnection('pixel', H264, log);

  const reconnect = (serial: string) => {
    log.push(`page opened ${serial}`);
    return Promise.resolve(back.connection);
  };

  const start = () => {
    log.push('worker started');
    return endpoint;
  };

  return { store, held, start, reconnect, back };
}

test('lends the phone to the Worker for a run, answers its frames, and takes it back once it stops', async () => {
  const log: string[] = [];
  const there = fakeConnection('pixel', H264, log);
  const { store, start, reconnect, back } = await setUp(log, () => Promise.resolve(there.connection));

  const run = await lend(store, start, reconnect);

  expect(store.phone, 'no other tab may reach it meanwhile').toBeNull();
  expect(await run.frame()).toMatchObject({ width: 360, height: 760 });
  expect(there.spawned).toEqual(['sh', expect.stringMatching(/^screenrecord /)]);

  run.stop();
  await run.ended;

  expect(store.phone).toBe(back.connection);
  expect(log).toEqual([
    'pixel let go',
    'worker started',
    'worker opened pixel',
    'pixel let go',
    'worker ended',
    'page opened pixel',
  ]);
  expect(await run.frame(), 'a frame asked for once stopped').toBeUndefined();
});

test('fails with why the Worker could not reach the phone, and holds the phone again all the same', async () => {
  const log: string[] = [];
  const { store, start, reconnect, back } = await setUp(log, () =>
    Promise.reject(new Error('the phone pixel is not plugged in, or this site may no longer reach it')),
  );

  await expect(lend(store, start, reconnect)).rejects.toThrow(/not plugged in/);

  expect(store.phone).toBe(back.connection);
  expect(log).toEqual(['pixel let go', 'worker started', 'worker opened pixel', 'worker ended', 'page opened pixel']);
});

test('ends the run when the phone is unplugged, saying so once the page has tried to take it back', async () => {
  const log: string[] = [];
  const there = fakeConnection('pixel', H264, log);
  const { store, start, reconnect, back } = await setUp(log, () => Promise.resolve(there.connection));
  const run = await lend(store, start, reconnect);

  there.unplug(new Error('the device was unplugged'));

  await expect(run.ended).rejects.toThrow('the device was unplugged');
  expect(log.at(-1)).toBe('page opened pixel');
  expect(store.phone).toBe(back.connection);
  await vi.waitFor(() => expect(new Set(there.killed)).toEqual(new Set(['screenrecord', 'sh'])));
});

test.for([
  ['its screen recording', 1, /^screen recording ended: /],
  ['its shell', 0, /^the phone's shell ended; is the phone still connected\?$/],
] as const)('ends the run when %s ends, with no frame asked for', async ([, which, reason]) => {
  const log: string[] = [];
  const there = fakeConnection('pixel', H264, log);
  const { store, start, reconnect, back } = await setUp(log, () => Promise.resolve(there.connection));
  const run = await lend(store, start, reconnect);

  there.processes[which]?.kill();

  await expect(run.ended).rejects.toThrow(reason);
  expect(store.phone).toBe(back.connection);
});

test('lends a phone once, a second `lend` meanwhile finding none', async () => {
  const there = fakeConnection('pixel', H264);
  const { store, start, reconnect } = await setUp([], () => Promise.resolve(there.connection));
  const first = lend(store, start, reconnect);

  await expect(lend(store, start, reconnect)).rejects.toThrow('no phone is connected');

  const run = await first;
  run.stop();
  await run.ended;
});

test('leaves a phone connected during the run held, letting the lent one go again once it is back', async () => {
  const log: string[] = [];
  const there = fakeConnection('pixel', H264, log);
  const { store, start, reconnect, back } = await setUp(log, () => Promise.resolve(there.connection));
  const run = await lend(store, start, reconnect);
  const other = fakeConnection('other', H264, log);

  await store.hold(other.connection);
  run.stop();
  await run.ended;

  expect(store.phone).toBe(other.connection);
  expect(log.slice(-2)).toEqual(['page opened pixel', 'pixel let go']);
  await expect(back.connection.disconnected).resolves.toBeUndefined();
});

test('fails a run whose connection closed unasked before the first frame, saying so', async () => {
  const log: string[] = [];
  const there = fakeConnection('pixel', H264, log);
  const { store, start, reconnect, back } = await setUp(log, async () => {
    await there.connection.close();
    return there.connection;
  });

  await expect(lend(store, start, reconnect)).rejects.toThrow('the connection to the phone closed');
  expect(store.phone).toBe(back.connection);
});

test('fails a run whose connection closed unasked, rather than end it as if stopped', async () => {
  const there = fakeConnection('pixel', H264);
  const { store, start, reconnect, back } = await setUp([], () => Promise.resolve(there.connection));
  const run = await lend(store, start, reconnect);

  await there.connection.close();

  await expect(run.ended).rejects.toThrow('the connection to the phone closed; is it still plugged in?');
  expect(store.phone).toBe(back.connection);
});

test('starts no Worker where the phone cannot be let go of, it being gone already', async () => {
  const { store, held, start, reconnect } = await setUp([], () => Promise.reject(new Error('never asked')));
  const started = vi.fn(start);
  vi.spyOn(held.connection, 'close').mockRejectedValue(new Error('the device was unplugged'));

  await expect(lend(store, started, reconnect)).rejects.toThrow('the device was unplugged');
  expect(started).not.toHaveBeenCalled();
});

test('holds the phone again where the Worker cannot be started', async () => {
  const { store, reconnect, back } = await setUp([], () => Promise.reject(new Error('never asked')));

  await expect(
    lend(
      store,
      () => {
        throw new Error('no Worker here');
      },
      reconnect,
    ),
  ).rejects.toThrow('no Worker here');
  expect(store.phone).toBe(back.connection);
});
