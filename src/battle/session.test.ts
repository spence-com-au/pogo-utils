/**
 * The Battle tab's run as the page renders from it, with `lend` and `loadBattle` stood in for: that a second start
 * while one is under way is ignored, that a failure to load the game data leaves the phone unlent, that what the run
 * tells is kept to the latest `KEPT` and that stopping goes once, and how each way a run can end reads.
 */

import { beforeEach, expect, test, vi } from 'vitest';

import { type PhoneStore } from '../phone-store.js';
import { type Reporter } from '../tools/battle/reporter.mts';
import { type Tally } from '../tools/battle/run.mts';
import { lend, type Run } from './client.js';
import { loadBattle } from './load.js';
import { Session } from './session.js';

vi.mock('./client.js', () => ({ lend: vi.fn() }));
vi.mock('./load.js', () => ({ loadBattle: vi.fn() }));

const STORE = {} as PhoneStore;
const PLAY = { mode: { mode: 'gbl', league: 'great' } as const, count: 3 };
const LOADED = { data: {}, icons: [], typeIcons: {}, meta: null };

/** A run to be ended by hand, with `stop` counted. */
function aRun() {
  let end!: { resolve: (tally: Tally | undefined) => void; reject: (error: Error) => void };

  const ended = new Promise<Tally | undefined>((resolve, reject) => {
    end = { resolve, reject };
  });

  return { run: { frame: async () => undefined, stop: vi.fn(), ended } satisfies Run, ...end };
}

/** Lets the pending promises settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('location', { href: 'http://localhost:8000/#/battle' });
  vi.mocked(loadBattle).mockResolvedValue(LOADED as never);
});

test('a start while one is connecting or running is ignored', async () => {
  const { run, resolve } = aRun();
  vi.mocked(lend).mockResolvedValue(run);

  const session = new Session();
  const first = session.start(STORE, PLAY);

  expect(session.phase.kind).toBe('connecting');
  await session.start(STORE, PLAY);
  expect(loadBattle).toHaveBeenCalledTimes(1);

  await settle();
  expect(session.phase.kind).toBe('running');
  await session.start(STORE, PLAY);
  expect(loadBattle).toHaveBeenCalledTimes(1);

  resolve(undefined);
  await first;
});

test('a failure to load the game data leaves the phone unlent', async () => {
  vi.mocked(loadBattle).mockRejectedValue(new Error('offline'));

  const session = new Session();
  await session.start(STORE, PLAY);

  expect(lend).not.toHaveBeenCalled();
  expect(session.phase).toStrictEqual({ kind: 'over', lines: ['offline'], failed: true });
});

test('a failure to lend the phone ends the run as failed', async () => {
  vi.mocked(lend).mockRejectedValue(new Error('no phone is connected'));

  const session = new Session();
  await session.start(STORE, PLAY);

  expect(session.phase).toStrictEqual({ kind: 'over', lines: ['no phone is connected'], failed: true });
});

test('the load is for the league of a GO Battle League run and for none of Training', async () => {
  vi.mocked(lend).mockResolvedValue({ ...aRun().run, ended: Promise.resolve(undefined) });

  const session = new Session();
  await session.start(STORE, PLAY);
  await session.start(STORE, { mode: { mode: 'training', leader: 'spark', league: 'great' }, count: 1 });

  expect(vi.mocked(loadBattle).mock.calls).toStrictEqual([['great'], [null]]);
});

test('what the run tells is kept to the latest thousand, and cleared by the next start', async () => {
  const { run, resolve } = aRun();
  vi.mocked(lend).mockImplementation(async (_store, _play, report: Reporter) => {
    for (let at = 0; at < 1_005; at++) {
      report.event(`line ${at}`, 'own', undefined);
    }

    return run;
  });

  const session = new Session();
  const started = session.start(STORE, PLAY);
  await settle();

  expect(session.told).toHaveLength(1_000);
  expect(session.told[0]).toStrictEqual({ line: 'line 5', side: 'own', why: undefined });
  expect(session.told.at(-1)?.line).toBe('line 1004');

  resolve(undefined);
  await started;
  expect(session.told).toHaveLength(1_000);

  vi.mocked(lend).mockResolvedValue({ ...aRun().run, ended: Promise.resolve(undefined) });
  await session.start(STORE, PLAY);
  expect(session.told).toStrictEqual([]);
});

test('stopping goes to the run once, and only while it runs', async () => {
  const { run, resolve } = aRun();
  vi.mocked(lend).mockResolvedValue(run);

  const session = new Session();
  session.stop();
  expect(run.stop).not.toHaveBeenCalled();

  const started = session.start(STORE, PLAY);
  await settle();
  session.stop();
  session.stop();

  expect(run.stop).toHaveBeenCalledTimes(1);
  expect(session.phase).toStrictEqual({ kind: 'running', run, stopping: true });

  resolve(undefined);
  await started;
});

test('a run stopped reads `Stopped.`', async () => {
  const { run, resolve } = aRun();
  vi.mocked(lend).mockResolvedValue(run);

  const session = new Session();
  const started = session.start(STORE, PLAY);
  await settle();
  resolve(undefined);
  await started;

  expect(session.phase).toStrictEqual({ kind: 'over', lines: ['Stopped.'], failed: false });
});

test('a run that finished reads how its battles went, and why it stopped short of `count`', async () => {
  const { run, resolve } = aRun();
  vi.mocked(lend).mockResolvedValue(run);

  const session = new Session();
  const started = session.start(STORE, PLAY);
  await settle();
  resolve({ battles: 2, won: 1, lost: 1 });
  await started;

  expect(session.phase).toStrictEqual({
    kind: 'over',
    lines: [
      '2 battles finished: 1 won and 1 lost',
      'GO Battle League has no battle to offer until its reward is collected',
    ],
    failed: false,
  });
});

test('a run that fails reads why', async () => {
  const { run, reject } = aRun();
  vi.mocked(lend).mockResolvedValue(run);

  const session = new Session();
  const started = session.start(STORE, PLAY);
  await settle();
  reject(new Error('the phone was unplugged'));
  await started;

  expect(session.phase).toStrictEqual({ kind: 'over', lines: ['the phone was unplugged'], failed: true });
});

test('a listener is told of each change until it unsubscribes', async () => {
  vi.mocked(lend).mockResolvedValue({ ...aRun().run, ended: Promise.resolve(undefined) });

  const session = new Session();
  const listener = vi.fn();
  const unsubscribe = session.subscribe(listener);
  await session.start(STORE, PLAY);

  const heard = listener.mock.calls.length;
  expect(heard).toBeGreaterThan(0);

  unsubscribe();
  await session.start(STORE, PLAY);
  expect(listener).toHaveBeenCalledTimes(heard);
});
