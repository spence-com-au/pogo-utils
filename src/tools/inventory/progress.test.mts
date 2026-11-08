/**
 * What `cached` says while downloading, and what it leaves behind — neither of which `cli.test.mts` can reach, the
 * cache it seeds being in date.
 *
 * Reached against a server on the loopback interface, which is hermetic in the way upstream is not and the only way to
 * fail a download on demand. A `file:` URL will not stand in: Node's `fetch` answers `TypeError: fetch failed`.
 *
 * Both lines below are outside the `--verbose` gate — the `Downloading` one because the week's grace already decides
 * which runs it prints on, the warning because a degraded answer is worth saying however quietly the run was asked to
 * go about it. So these are the assertions that would notice either being swept into `progress`.
 */

import { cached, cachedAs } from './download.mts';
import { showProgress } from './progress.mts';
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';

/** How the server answers the next request, set by whichever test is running. */
let answer: (response: ServerResponse) => void = (response) => response.end();
let base = '';

const server = createServer((_request, response) => answer(response));

beforeAll(async () => {
  await new Promise<void>((listening) => void server.listen(0, '127.0.0.1', listening));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(async () => {
  await new Promise((closed) => server.close(closed));
});

/** A cache of its own per test, so that one test's download is never another's copy from before. */
const cacheDir = () => mkdtempSync(join(tmpdir(), 'inventory-progress-'));

/** What `body` answered, and every line it printed to stderr while answering. */
async function stderrOf<T>(body: () => Promise<T>): Promise<[T, string[]]> {
  const said = vi.spyOn(console, 'error').mockImplementation(() => {});

  try {
    return [await body(), said.mock.calls.map((call) => String(call[0]))];
  } finally {
    said.mockRestore();
  }
}

/**
 * A module nobody has spoken to narrates. Every consumer of `iconsFor` today calls `showProgress`, so the caller that
 * would notice this is the one not written yet. Imported afresh rather than read off the instance the tests below set,
 * so this is the module's own starting state rather than whatever ran last.
 */
test('progress is narrated until a caller asks for quiet', async () => {
  vi.resetModules();

  const fresh = await import('./progress.mts');
  const [, said] = await stderrOf(async () => fresh.progress('Reading 3 form icons'));

  expect(said).toStrictEqual(['Reading 3 form icons']);
});

/**
 * The one line a cold run is waiting on, which prints whether or not progress was asked for. It is reached only past
 * the week's grace, so it never lands on the warm run `--verbose` was added to quieten, and `showProgress(false)` must
 * not take it: that would silence a first `pnpm inventory snap` for the minutes it spends on 162 icons.
 */
test('`cached` names the download it is about to make, quietly or not', async () => {
  answer = (response) => response.end('{}');

  const url = `${base}latest.json`;
  const loud = cacheDir();
  const quiet = cacheDir();

  try {
    showProgress(true);
    expect((await stderrOf(() => cached(loud, 'latest.json', url, false)))[1]).toStrictEqual([`Downloading ${url}`]);

    showProgress(false);
    expect((await stderrOf(() => cached(quiet, 'latest.json', url, false)))[1]).toStrictEqual([`Downloading ${url}`]);
  } finally {
    rmSync(loud, { recursive: true });
    rmSync(quiet, { recursive: true });
  }
});

/**
 * The warm run is the one the gate is for, and the week's grace is what makes it quiet: a copy already in date is read
 * without a word, so there is nothing for `--verbose` to hold back. This is the assertion that would fail if the guard
 * above the `Downloading` line were ever loosened, leaving it to a flag instead.
 */
test('`cached` says nothing where the copy it has is in date', async () => {
  answer = (response) => response.end('{}');

  const url = `${base}latest.json`;
  const dir = cacheDir();

  try {
    showProgress(true);
    await cached(dir, 'latest.json', url, false);

    expect((await stderrOf(() => cached(dir, 'latest.json', url, false)))[1]).toStrictEqual([]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

/**
 * The warning under a failed download names what went stale on a quiet run too, which is the split `progress.mts`
 * claims: progress is held back and a degraded answer is not.
 *
 * It names the URL rather than reading as a continuation, which is why the assertion takes both lines whole:
 * `iconsFor` keeps 16 downloads in flight, so a bare `fetch failed; using the copy from before` could sit under any of
 * them and name none. Back-dated by hand rather than by `cached`'s own `WEEK`, which it does not export.
 */
test('a stale copy read because the download failed names the file, quietly or not', async () => {
  answer = (response) => {
    response.statusCode = 503;
    response.end();
  };

  const dir = cacheDir();
  const url = `${base}PIKACHU.png`;
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

  writeFileSync(join(dir, 'PIKACHU.png'), 'the copy from before');
  utimesSync(join(dir, 'PIKACHU.png'), eightDaysAgo, eightDaysAgo);

  try {
    showProgress(false);

    const [bytes, said] = await stderrOf(() => cached(dir, 'PIKACHU.png', url, false));

    expect(String(bytes), 'the copy from before was not read, so the warning below is about something else').toBe(
      'the copy from before',
    );
    expect(said).toStrictEqual([`Downloading ${url}`, `  ${url}: 503 Service Unavailable; using the copy from before`]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

/**
 * And the other side of that `catch`: with no copy to fall back on, a failed download throws, naming the URL and why,
 * and leaves nothing in the cache for the week's grace to read. A status and a connection dropped before any answer
 * both, the second keeping what `fetch` threw as its `cause`.
 */
test('a download that fails with no copy to fall back on throws, naming the URL, and leaves nothing behind', async () => {
  const dir = cacheDir();
  const url = `${base}file.json`;
  const failure = () => cached(dir, 'file.json', url, false).catch((error: unknown) => error);

  try {
    showProgress(false);

    answer = (response) => {
      response.statusCode = 503;
      response.end();
    };

    const [refused, said] = await stderrOf(failure);

    expect(refused).toMatchObject({ message: `${url}: 503 Service Unavailable` });
    expect(said, 'a copy from before was claimed where there is none').toStrictEqual([`Downloading ${url}`]);

    answer = (response) => response.destroy();

    const [dropped] = await stderrOf(failure);

    expect(dropped).toMatchObject({
      message: `${url}: fetch failed`,
      cause: expect.objectContaining({ name: 'TypeError', message: 'fetch failed' }),
    });
    expect(readdirSync(dir)).toStrictEqual([]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

/**
 * A body that will not decode is not left behind to be read for the week. `cached` writes and renames before it
 * returns, so a 200 carrying an error page is cached before anything has parsed it — and the week's grace would read
 * that HTML off disk for seven days, past the `Downloading` line, until someone passed `--refresh`.
 *
 * Driven as two calls with the server mended between them, which asserts the consequence rather than the mechanism:
 * the second answers from upstream where it would otherwise answer from the poisoned copy.
 */
test('a download that will not decode is not left to be read for the week', async () => {
  const dir = cacheDir();
  const url = `${base}icons.json`;
  const parse = (bytes: Buffer): unknown => JSON.parse(String(bytes));

  try {
    showProgress(false);
    answer = (response) => response.end('<html>502 Bad Gateway</html>');

    await expect(stderrOf(() => cachedAs(dir, 'icons.json', url, false, parse))).rejects.toThrow(url);

    answer = (response) => response.end('{"tree":[]}');

    const [listing] = await stderrOf(() => cachedAs(dir, 'icons.json', url, false, parse));

    expect(listing, 'the copy that would not decode was read again rather than fetched afresh').toStrictEqual({
      tree: [],
    });
  } finally {
    rmSync(dir, { recursive: true });
  }
});
