/**
 * `scripts/prune-events.mts` and `scripts/vend-feed.mts` driven as subprocesses. Both keep their orchestration at the
 * top level, so importing one runs it, and both commit what they write to `master` unattended — the Prune and Vend
 * workflows — so the order they do things in is the behaviour. `src/event-feed.test.ts` and `src/gpx-source.test.mts`
 * pin the pieces; this pins how they are put together, which nothing else reaches.
 *
 * Hermetic for the same reason `src/serve.test.mts` is: the paths in `src/event-feed.ts` are relative, so the
 * directory a subprocess runs in decides which `data/` it reads and writes. Each test gets a git repository of its own,
 * `scripts/prune-events.mts` listing the GPX files through `git ls-files`. The vend's one network call is replaced by a
 * preloaded `fetch` that answers with the test's feed, so nothing here leaves the machine.
 *
 * A run that fails for an unrelated reason leaves every file as it found it, which is also what an all-or-nothing run
 * that did refuse looks like. The failing cases therefore match the message they expect, not just the exit code.
 */

import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, expect, test } from 'vitest';

import type { StampedEvent } from './event-feed.ts';

const PRUNE = fileURLToPath(new URL('../scripts/prune-events.mts', import.meta.url));
const VEND = fileURLToPath(new URL('../scripts/vend-feed.mts', import.meta.url));

const ANSWER = 'globalThis.fetch = async () => new Response(process.env.UPSTREAM)';

/** Preloaded into the vend to answer its one `fetch` with the `UPSTREAM` environment variable. */
const FETCH_STUB = `data:text/javascript,${encodeURIComponent(ANSWER)}`;

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

/** A git repository holding `files`, every one of them tracked, which is what `git ls-files` lists. */
function repository(files: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), 'pogo-events-'));
  directories.push(directory);

  execFileSync('git', ['init', '--quiet'], { cwd: directory });

  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(join(directory, dirname(path)), { recursive: true });
    writeFileSync(join(directory, path), contents);
  }

  execFileSync('git', ['add', '--', ...Object.keys(files)], { cwd: directory });

  return directory;
}

/** The script's exit code and output. A non-zero exit is an answer here rather than a failure. */
async function run(cwd: string, args: string[], upstream = '') {
  const env = { ...process.env, UPSTREAM: upstream };

  return promisify(execFile)(process.execPath, args, { cwd, env }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error: { code: number; stdout: string; stderr: string }) => error,
  );
}

const read = (directory: string, path: string) => readFileSync(join(directory, path), 'utf8');

const events = (directory: string, path: string): StampedEvent[] => JSON.parse(read(directory, path));

/** The way the scripts write a list, which is also the way `prettier` would. */
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const event = (eventID: string, over: Partial<StampedEvent> = {}): StampedEvent => ({
  eventID,
  name: eventID,
  eventType: 'regional-event',
  heading: 'Regional Event',
  link: 'https://example.com/',
  image: 'https://example.com/image.jpg',
  start: '2020-01-01T00:00:00.000Z',
  end: '2999-01-01T00:00:00.000Z',
  ...over,
});

/** Over by every clock, so `prunable` says so unless the vended list carries it. */
const ended = (eventID: string) => event(eventID, { end: '2020-01-02T00:00:00.000Z' });

/** A GPX file around `body`, with the namespace on the root as the files in `data/` bind it. */
const gpx = (body: string) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx xmlns="http://www.topografix.com/GPX/1/1"',
    '     xmlns:pgr="https://spence.com.au/pogo-utils/gpx/1" version="1.1" creator="test">',
    body,
    '</gpx>',
    '',
  ].join('\n');

/** A waypoint naming each of `ids`, each reference on a line of its own. */
const waypoint = (...ids: string[]) =>
  gpx(
    [
      '  <wpt lat="0" lon="0">',
      '    <extensions>',
      ...ids.map((id) => `      <pgr:event>${id}</pgr:event>`),
      '    </extensions>',
      '  </wpt>',
    ].join('\n'),
  );

test('prune drops an ended event from the list and every reference to it from the GPX', async () => {
  const directory = repository({
    'data/events.json': json([ended('over-2020'), event('live-2999')]),
    'data/events-feed.json': json([]),
    'data/one.gpx': waypoint('over-2020', 'live-2999'),
    'data/two.gpx': waypoint('live-2999'),
  });

  const { code, stdout } = await run(directory, [PRUNE]);

  expect(code).toBe(0);
  expect(stdout).toContain('removed over-2020');
  expect(read(directory, 'data/events.json')).toBe(json([event('live-2999')]));
  expect(read(directory, 'data/one.gpx')).toBe(waypoint('live-2999'));
  expect(read(directory, 'data/two.gpx')).toBe(waypoint('live-2999'));
});

test('prune writes nothing when the only ended event is one the vended list also carries', async () => {
  // Removing it would uncover upstream's copy, which is what `prunable` exists to refuse; here it is the script's
  // early exit that has to leave the GPX files alone as well.
  const files = {
    'data/events.json': json([event('live-2999'), ended('override-2020')]),
    'data/events-feed.json': json([ended('override-2020')]),
    'data/one.gpx': waypoint('override-2020', 'live-2999'),
  };
  const directory = repository(files);

  const { code, stdout } = await run(directory, [PRUNE]);

  expect(code).toBe(0);
  expect(stdout).toContain('nothing has ended');

  for (const [path, contents] of Object.entries(files)) {
    expect(read(directory, path), path).toBe(contents);
  }
});

test.each([
  // xmldom hands a fatal error to a handler and returns a document regardless, which `parseGpx` turns into a throw.
  ['a file that is not well-formed', '<gpx><wpt></gpx>', /Opening and ending tag mismatch/],

  // Well-formed, and the one shape `cutElements` refuses for want of an extent it can read.
  [
    'a reference it cannot cut',
    gpx('  <wpt><pgr:event>over-2020<!-- </pgr:event> --></pgr:event></wpt>'),
    /not by its own end tag/,
  ],
])('prune writes nothing at all when it cannot edit %s', async (_, broken, message) => {
  /*
   * `data/a.gpx` sorts first and is editable, so a run that wrote each file as it went would have rewritten it by the
   * time `data/b.gpx` threw, and one that wrote `data/events.json` ahead of the edits would have lost the entry whose
   * references `validate-gpx.mts` then refuses. Either leaves a tree the build rejects.
   */
  const files = {
    'data/events.json': json([ended('over-2020'), event('live-2999')]),
    'data/events-feed.json': json([]),
    'data/a.gpx': waypoint('over-2020', 'live-2999'),
    'data/b.gpx': broken,
  };
  const directory = repository(files);

  const { code, stderr } = await run(directory, [PRUNE]);

  expect(code).not.toBe(0);
  expect(stderr).toMatch(message);

  for (const [path, contents] of Object.entries(files)) {
    expect(read(directory, path), path).toBe(contents);
  }
});

/** The vend run in `files`, answering its `fetch` with `upstream`, and the window the clock was read within. */
async function vend(files: Record<string, string>, upstream: StampedEvent[]) {
  const directory = repository(files);
  const from = Date.now();
  const { code, stdout, stderr } = await run(directory, ['--import', FETCH_STUB, VEND], JSON.stringify(upstream));
  const to = Date.now();

  expect(stderr).toBe('');
  expect(code).toBe(0);

  return {
    directory,
    stdout,

    /** Whether `added` is an instant the run itself stamped, as against one carried in from a file. */
    isNow(added: string | undefined) {
      const at = Date.parse(added ?? '');

      return at >= from && at <= to;
    },
  };
}

test('vend keeps the previous copy’s stamp over a local entry’s, which stands in for a missing one', async () => {
  // `held` is in all three, with two different stamps: the previous copy's wins, being the instant the page first saw
  // it. `promoted` is new to the feed but already on the page through `data/events.json`, so its local stamp stands in
  // for the clock. `fresh` is the only one the run itself stamps.
  const { directory, isNow } = await vend(
    {
      'data/events-feed.json': json([event('held', { added: '2026-01-01T00:00:00.000Z' })]),
      'data/events.json': json([
        event('held', { added: '2026-02-02T00:00:00.000Z' }),
        event('promoted', { added: '2026-03-03T00:00:00.000Z' }),
      ]),
    },
    [event('fresh'), event('held'), event('promoted')],
  );

  const vended = events(directory, 'data/events-feed.json');

  expect(vended.map(({ eventID }) => eventID)).toEqual(['fresh', 'held', 'promoted']);
  expect(vended.map(({ added }) => added)).toEqual([
    expect.stringMatching(/Z$/),
    '2026-01-01T00:00:00.000Z',
    '2026-03-03T00:00:00.000Z',
  ]);
  expect(isNow(vended[0]?.added)).toBe(true);
});

test('vend leaves a stamped data/events.json exactly as it was', async () => {
  // Not even reformatted: `data/events.json` is written by hand, and a run that stamps nothing has no business
  // producing a diff in it. The compact, unterminated form is what would show a rewrite.
  const local = JSON.stringify([event('held', { added: '2026-02-02T00:00:00.000Z' })]);
  const { directory, stdout } = await vend({ 'data/events.json': local }, [event('held')]);

  expect(read(directory, 'data/events.json')).toBe(local);
  expect(stdout).not.toContain('stamped');
});

test('vend stamps a data/events.json entry with the feed’s stamp for its ID, else with its own run', async () => {
  const { directory, stdout, isNow } = await vend(
    {
      'data/events-feed.json': json([event('known', { added: '2026-01-01T00:00:00.000Z' })]),
      'data/events.json': json([event('known'), event('new-to-feed'), event('local-only')]),
    },
    [event('known'), event('new-to-feed')],
  );

  const vended = events(directory, 'data/events-feed.json');
  const local = events(directory, 'data/events.json');

  // An override carries the stamp of the entry it replaces, so the two copies of one event can never disagree.
  expect(local[0]?.added).toBe('2026-01-01T00:00:00.000Z');
  expect(local[1]?.added).toBe(vended.find(({ eventID }) => eventID === 'new-to-feed')?.added);
  expect(isNow(local[1]?.added)).toBe(true);
  expect(isNow(local[2]?.added)).toBe(true);

  expect(read(directory, 'data/events.json')).toBe(json(local));
  expect(stdout).toContain('stamped known, new-to-feed, local-only');
});
