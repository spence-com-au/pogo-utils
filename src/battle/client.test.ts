/**
 * The page and the battle's Worker talking over a channel as they would across the Worker's boundary, each message
 * cloned, with stand-ins for the phone over WebUSB, `FakeDecoder` for WebCodecs and an OCR engine that reads nothing,
 * and the battle loop itself playing what the phone's screen shows: who holds the phone when, what the page is told and
 * answered, how the phone is kept awake and put back, and how a run that fails hands the phone back all the same.
 */

import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { Phone as Connection } from '../inventory/webusb.js';
import { PhoneStore } from '../phone-store.js';
import { fixture } from '../testing/fixture.js';
import { type Status } from '../tools/battle/reporter.mts';
import { type GameData } from '../tools/inventory/game-master.mts';
import { putBack } from './awake.js';
import { lend, type Endpoint } from './client.js';
import { host } from './host.js';
import { type Play } from './protocol.js';
import { FakeChunk, FakeDecoder, fakeConnection } from './test-phone.js';

const H264 = fixture(new URL('../tools/battle/fixtures/charge.h264', import.meta.url));

/** A Great League training battle against Spark, the opponents' moves narrowed to none, which the run says first. */
const PLAY: Play = {
  battle: {
    mode: { mode: 'training', leader: 'spark', league: 'great' },
    data: JSON.parse(
      new TextDecoder().decode(fixture(new URL('../tools/inventory/fixtures/game-master.json', import.meta.url))),
    ) as GameData,
    icons: [],
    typeIcons: {},
    meta: { cup: 'all', cap: 1500, movesets: new Map() },
  },
  base: 'http://localhost:8000/#/battle',
};

/** What the page is told, event by event and the latest status. */
function told() {
  const events: string[] = [];
  const statuses: Status[] = [];

  return {
    events,
    statuses,
    report: {
      event: (line: string, side?: string, why?: string) =>
        events.push([side, line, why].filter((part) => part !== undefined).join(': ')),
      status: (status: Status) => statuses.push(status),
    },
  };
}

let channel: MessageChannel;

beforeEach(() => {
  FakeDecoder.made = [];
  FakeDecoder.failing = false;
  vi.stubGlobal('VideoDecoder', FakeDecoder);
  vi.stubGlobal('EncodedVideoChunk', FakeChunk);
  vi.stubGlobal('indexedDB', new IDBFactory());
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
async function setUp(log: string[], open: (serial: string) => Promise<Connection>, bases: string[] = []) {
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
    (base) => {
      bases.push(base);

      return { tsv: () => Promise.resolve(''), terminate: () => Promise.resolve() };
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

  const run = await lend(store, PLAY, told().report, start, reconnect);

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

test('plays the battle in the Worker, telling the page what it does, and puts the phone back as found when stopped', async () => {
  const there = fakeConnection('pixel', H264);
  there.settings.set('stay_on_while_plugged_in', '1');
  const bases: string[] = [];
  const { store, start, reconnect } = await setUp([], () => Promise.resolve(there.connection), bases);
  const { events, statuses, report } = told();

  const run = await lend(store, PLAY, report, start, reconnect);

  await vi.waitFor(() => expect(statuses.length).toBeGreaterThan(0));
  expect(events[0]).toBe("opponents' moves as PvPoke ranks all at 1500 CP: 0 species");
  expect(statuses.at(-1)).toMatchObject({ battles: 0, count: Infinity, screen: 'other', lostAfter: 20_000 });
  expect(bases, 'the OCR found against the page').toEqual([PLAY.base]);
  expect(there.ran).toEqual(['settings get global stay_on_while_plugged_in', 'svc power stayon usb']);

  run.stop();

  await expect(run.ended).resolves.toBeUndefined();
  expect(there.ran.at(-1)).toBe('settings put global stay_on_while_plugged_in 1');

  // Nothing left kept for the next connect to put back.
  const next = fakeConnection('pixel', H264);
  await putBack(next.connection);
  expect(next.ran).toEqual([]);
});

test('puts the phone back as found at its next connect, where its tab was closed mid-run', async () => {
  const there = fakeConnection('pixel', H264);
  there.settings.set('stay_on_while_plugged_in', '1');
  const { store, start, reconnect } = await setUp([], () => Promise.resolve(there.connection));
  const run = await lend(store, PLAY, told().report, start, reconnect);

  // The Worker ended with its tab, mid-run, before it could put anything back: what the next page finds.
  const next = fakeConnection('pixel', H264);
  await putBack(next.connection);
  await putBack(next.connection);

  expect(next.ran, 'put back once, then forgotten').toEqual(['settings put global stay_on_while_plugged_in 1']);

  run.stop();
  await run.ended;
});

test('puts the phone back as found once the page takes it back, where the Worker could not', async () => {
  const there = fakeConnection('pixel', H264);
  there.settings.set('stay_on_while_plugged_in', '1');
  const { store, start, reconnect, back } = await setUp([], () => Promise.resolve(there.connection));
  const { events, report } = told();
  const run = await lend(store, PLAY, report, start, reconnect);

  there.connection.transport.shell = () => Promise.reject(new Error('the shell has gone'));
  run.stop();
  await run.ended;

  expect(events).toContain(
    'stay_on_while_plugged_in not put back to 1 until the phone is next connected: the shell has gone',
  );
  expect(store.phone).toBe(back.connection);
  expect(back.ran).toEqual(['settings put global stay_on_while_plugged_in 1']);

  const next = fakeConnection('pixel', H264);
  await putBack(next.connection);
  expect(next.ran, 'nothing left kept').toEqual([]);
});

test('fails with why the Worker could not reach the phone, and holds the phone again all the same', async () => {
  const log: string[] = [];
  const { store, start, reconnect, back } = await setUp(log, () =>
    Promise.reject(new Error('the phone pixel is not plugged in, or this site may no longer reach it')),
  );

  await expect(lend(store, PLAY, told().report, start, reconnect)).rejects.toThrow(/not plugged in/);

  expect(store.phone).toBe(back.connection);
  expect(log).toEqual(['pixel let go', 'worker started', 'worker opened pixel', 'worker ended', 'page opened pixel']);
});

test('ends the run when the phone is unplugged, saying so once the page has tried to take it back', async () => {
  const log: string[] = [];
  const there = fakeConnection('pixel', H264, log);
  const { store, start, reconnect, back } = await setUp(log, () => Promise.resolve(there.connection));
  const run = await lend(store, PLAY, told().report, start, reconnect);

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
  const run = await lend(store, PLAY, told().report, start, reconnect);

  there.processes[which]?.kill();

  await expect(run.ended).rejects.toThrow(reason);
  expect(store.phone).toBe(back.connection);
});

test('lends a phone once, a second `lend` meanwhile finding none', async () => {
  const there = fakeConnection('pixel', H264);
  const { store, start, reconnect } = await setUp([], () => Promise.resolve(there.connection));
  const first = lend(store, PLAY, told().report, start, reconnect);

  await expect(lend(store, PLAY, told().report, start, reconnect)).rejects.toThrow('no phone is connected');

  const run = await first;
  run.stop();
  await run.ended;
});

test('leaves a phone connected during the run held, not reopening the lent one', async () => {
  const log: string[] = [];
  const there = fakeConnection('pixel', H264, log);
  const { store, start } = await setUp(log, () => Promise.resolve(there.connection));
  const reconnect = vi.fn(() => Promise.reject(new Error('unplugged for the other')));
  const run = await lend(store, PLAY, told().report, start, reconnect);
  const other = fakeConnection('other', H264, log);

  await store.hold(other.connection);
  run.stop();
  await run.ended;

  expect(store.phone).toBe(other.connection);
  expect(reconnect).not.toHaveBeenCalled();
});

test('lets the lent phone go again where another is connected while it is being reopened', async () => {
  const log: string[] = [];
  const there = fakeConnection('pixel', H264, log);
  const { store, start, back } = await setUp(log, () => Promise.resolve(there.connection));
  const other = fakeConnection('other', H264, log);

  const run = await lend(store, PLAY, told().report, start, async () => {
    await store.hold(other.connection);
    return back.connection;
  });

  run.stop();
  await run.ended;

  expect(store.phone).toBe(other.connection);
  await expect(back.connection.disconnected).resolves.toBeUndefined();
});

test('takes a reopen that fails as no failure where another phone was connected meanwhile', async () => {
  const there = fakeConnection('pixel', H264);
  const { store, start } = await setUp([], () => Promise.resolve(there.connection));
  const other = fakeConnection('other', H264);

  const run = await lend(store, PLAY, told().report, start, async () => {
    await store.hold(other.connection);
    throw new Error('the phone is held by something else');
  });

  run.stop();
  await run.ended;

  expect(store.phone).toBe(other.connection);
});

test('fails a run whose connection closed unasked before the first frame, saying so', async () => {
  const log: string[] = [];
  const there = fakeConnection('pixel', H264, log);
  const { store, start, reconnect, back } = await setUp(log, async () => {
    await there.connection.close();
    return there.connection;
  });

  await expect(lend(store, PLAY, told().report, start, reconnect)).rejects.toThrow(
    'the connection to the phone closed',
  );
  expect(store.phone).toBe(back.connection);
});

test('fails a run whose connection closed unasked, rather than end it as if stopped', async () => {
  const there = fakeConnection('pixel', H264);
  const { store, start, reconnect, back } = await setUp([], () => Promise.resolve(there.connection));
  const run = await lend(store, PLAY, told().report, start, reconnect);

  await there.connection.close();

  await expect(run.ended).rejects.toThrow('the connection to the phone closed; is it still plugged in?');
  expect(store.phone).toBe(back.connection);
});

test('starts no Worker where the phone cannot be let go of, it being gone already', async () => {
  const { store, held, start, reconnect } = await setUp([], () => Promise.reject(new Error('never asked')));
  const started = vi.fn(start);
  vi.spyOn(held.connection, 'close').mockRejectedValue(new Error('the device was unplugged'));

  await expect(lend(store, PLAY, told().report, started, reconnect)).rejects.toThrow('the device was unplugged');
  expect(started).not.toHaveBeenCalled();
});

test('holds the phone again where the Worker cannot be started', async () => {
  const { store, reconnect, back } = await setUp([], () => Promise.reject(new Error('never asked')));

  await expect(
    lend(
      store,
      PLAY,
      told().report,
      () => {
        throw new Error('no Worker here');
      },
      reconnect,
    ),
  ).rejects.toThrow('no Worker here');
  expect(store.phone).toBe(back.connection);
});
