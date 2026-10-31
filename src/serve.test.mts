/**
 * The local server, driven as a subprocess. Nothing imported `scripts/serve.mts` before this, and nothing under
 * `scripts/` is reachable by the suite at all — `vitest.config.mjs` scopes `dir` to `src/` — so three inputs that
 * ended the process rather than the request passed 1272 tests without being seen: `/%` through `decodeURIComponent`,
 * `/%00.html` through `statSync`, and an unreadable file through a `createReadStream` whose `'error'` nothing handled.
 *
 * Driven rather than imported because importing it runs it: the `dist/` guard, `createServer` and `listen` are all at
 * the top level. A subprocess is also the interface a person uses, and the one where a `throw` in a request listener
 * shows up as what it is — a dead server rather than a rejected promise.
 *
 * `DIST` in that script is relative, which is the whole of why this is hermetic: the directory a subprocess runs in
 * decides what it serves, so each test gets a `dist/` of its own holding one file per extension and no build is
 * needed. The same property is what `src/tools/inventory/cli.test.mts` uses for the scanner's cache.
 *
 * Every crash test asserts twice — the bad request got an answer, and a later good request still gets one. The second
 * assertion is the one that would have caught these: a dead server also "answers" the first request, with a socket
 * error that reads much like a refusal if nothing looks any further.
 *
 * What this cannot check is the table itself. It reads `SERVED_TYPES` to assert against, so it pins that the server
 * honours the table and says nothing about whether the table still matches the deployment. Nothing here does — a
 * header Pages changes is found by `curl -sI` against the published file, not by this going red.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { SERVED_TYPES } from '../scripts/served-types.mts';

const SCRIPT = fileURLToPath(new URL('../scripts/serve.mts', import.meta.url));

/** The line the server prints once it is up, and where the port it actually bound is read from. */
const SERVING = /http:\/\/127\.0\.0\.1:(\d+)\//;

/**
 * One servable file per extension in `SERVED_TYPES`, which is what lets the per-extension test below walk the table
 * rather than a sample of it: a new entry in the table with no file here fails that test instead of going unchecked.
 * Exactly one file per extension, so `manifest.json` is the only `.json` — `locked.json` is deliberately not in here.
 */
const SERVABLE: Record<string, string> = {
  'index.html': '<!doctype html><title>fixture</title>',
  'src/main.css': 'body { color: red }',
  'src/main.js': 'export const fixture = 1;',
  'events.ics': 'BEGIN:VCALENDAR\nEND:VCALENDAR',
  'data/sample.gpx': '<?xml version="1.0"?><gpx version="1.1"></gpx>',
  'manifest.json': '{ "name": "fixture" }',
  'icons/192.png': 'not really a png, and nothing here decodes one',
  'favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  'src/tools/battle/fixtures/demo.h264': 'not really H.264 either',
};

/**
 * The two files that exist to be refused, and both halves of "exist" are the point. A 404 for a file that was never
 * there says nothing about an allowlist, and a stream error needs a `statSync` that succeeded first.
 */
const EXTRAS: Record<string, string> = {
  'probe.txt': 'an extension the table has no entry for',
  'locked.json': '{ "readable": false }',
};

/** Where to find each extension, derived so that the table and these fixtures cannot drift apart silently. */
const BY_EXTENSION: Record<string, string> = Object.fromEntries(
  Object.keys(SERVABLE).map((path) => [extname(path), path]),
);

/** Only ever killed through this, so the narrower `stdio` type each `spawn` returns is not wanted here. */
const running: ChildProcess[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const child of running.splice(0)) {
    child.kill('SIGKILL');
  }

  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

/** A working directory holding a `dist/` of fixtures, or an empty one where `dist` is false. */
const workspace = (dist = true) => {
  const directory = mkdtempSync(join(tmpdir(), 'pogo-serve-'));
  directories.push(directory);

  if (!dist) {
    return directory;
  }

  for (const [path, content] of Object.entries({ ...SERVABLE, ...EXTRAS })) {
    const file = join(directory, 'dist', path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }

  /*
   * Unreadable rather than absent, so `statSync` succeeds and the failure lands in the stream — the case the handler
   * writes its head on `'open'` for. A root runner could read it anyway and see a 200; GitHub's is not root, and
   * failing on one that is beats a skip that reads like a pass.
   */
  chmodSync(join(directory, 'dist', 'locked.json'), 0o000);

  return directory;
};

/**
 * A request with the path sent exactly as written, which `fetch` cannot do: the WHATWG URL parser collapses `/../`
 * before anything goes out, so a traversal asserted through `fetch` would be asserting against `/package.json` and
 * passing without the server's own check ever running.
 */
const raw = (port: number, path: string) =>
  new Promise<number>((resolve, reject) => {
    const sent = httpRequest({ host: '127.0.0.1', port, path, method: 'GET' }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode ?? 0));
    });

    sent.on('error', reject);
    sent.end();
  });

/** The server, started on whatever port it could get, with that port read back off its own output. */
const serve = async (cwd: string) => {
  const child = spawn(process.execPath, [SCRIPT], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  running.push(child);

  const port = await new Promise<number>((resolve, reject) => {
    let output = '';

    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const found = SERVING.exec(output);

      if (found?.[1] !== undefined) {
        resolve(Number(found[1]));
      }
    });

    child.on('exit', (code) => reject(new Error(`Exited ${code} before serving:\n${output}`)));
    child.on('error', reject);
  });

  return { port, pid: child.pid, url: (path: string) => `http://127.0.0.1:${port}${path}` };
};

/**
 * A request abandoned once its body has started, which is a stop button or a reload during a download. Resolving on
 * the first chunk is what makes it mid-body rather than before the response: an abort before the stream opens would
 * never reach the descriptor this is about.
 */
const abort = (port: number, path: string) =>
  new Promise<void>((resolve) => {
    const sent = httpRequest({ host: '127.0.0.1', port, path }, (response) => {
      response.once('data', () => {
        sent.destroy();
        resolve();
      });
    });

    /* `destroy()` surfaces here as `ECONNRESET`, which is the abort working rather than a failure. */
    sent.on('error', () => resolve());
    sent.end();
  });

test('serves every extension in the table as the type the table gives', async () => {
  const { url } = await serve(workspace());

  const unfixtured = Object.keys(SERVED_TYPES).filter((extension) => BY_EXTENSION[extension] === undefined);
  expect(unfixtured).toEqual([]);

  for (const [extension, type] of Object.entries(SERVED_TYPES)) {
    const response = await fetch(url(`/${BY_EXTENSION[extension]}`));

    expect(response.status, extension).toBe(200);
    expect(response.headers.get('content-type'), extension).toBe(type);
  }
});

test('serves index.html for the root', async () => {
  const { url } = await serve(workspace());
  const response = await fetch(url('/'));

  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  expect(await response.text()).toContain('fixture');
});

test('answers HEAD with the type and no body', async () => {
  const { url } = await serve(workspace());
  const response = await fetch(url('/events.ics'), { method: 'HEAD' });

  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('text/calendar');
  expect(await response.text()).toBe('');
});

test('refuses a file it has no type for, and one that is not there', async () => {
  const { url } = await serve(workspace());

  /* `probe.txt` is on disk, so this 404 is the allowlist's rather than the filesystem's. */
  expect((await fetch(url('/probe.txt'))).status).toBe(404);
  expect((await fetch(url('/nothing.html'))).status).toBe(404);
});

test('refuses a path that climbs out of dist, and resolves one that does not', async () => {
  const { port } = await serve(workspace());

  for (const path of ['/../package.json', '/%2e%2e/package.json', '/../../../../etc/passwd']) {
    expect(await raw(port, path), path).toBe(404);
  }

  expect(await raw(port, '/src/../index.html')).toBe(200);
});

test('survives a malformed percent-escape', async () => {
  const { port } = await serve(workspace());

  for (const path of ['/%', '/%zz', '/%E0%A4']) {
    expect(await raw(port, path), path).toBe(404);
  }

  expect(await raw(port, '/index.html')).toBe(200);
});

test('survives a NUL byte in the path', async () => {
  const { port } = await serve(workspace());

  expect(await raw(port, '/%00.html')).toBe(404);
  expect(await raw(port, '/index.html')).toBe(200);
});

test('survives a file it cannot read, and answers before a status is committed', async () => {
  const { port } = await serve(workspace());

  expect(await raw(port, '/locked.json')).toBe(500);
  expect(await raw(port, '/index.html')).toBe(200);
});

/**
 * Enough of a file that a response is still in flight when the client goes away, the leaked descriptor only being
 * reachable mid-body: a few hundred bytes of fixture leaves in one packet whether anyone aborts it or not.
 */
const ABORTABLE = 8 * 1024 * 1024;

/*
 * Counted through `/proc`, so Linux only. The leak is not platform-specific but measuring it from outside the process
 * is, and `ubuntu-latest` is every runner in `.github/workflows/`, so the gate is where it has to be. Nothing else in
 * this file needs deselecting anywhere.
 */
test.skipIf(process.platform !== 'linux')('closes the file it was reading when a client goes away', async () => {
  const directory = workspace();
  writeFileSync(join(directory, 'dist', 'data', 'big.gpx'), 'x'.repeat(ABORTABLE));

  const { port, pid, url } = await serve(directory);

  if (pid === undefined) {
    throw new Error('The server reported no pid to count descriptors against.');
  }

  /** Descriptors onto that one file, which socket churn cannot move the way a whole-of-`fd` count would be moved. */
  const held = () =>
    readdirSync(`/proc/${pid}/fd`).filter((descriptor) => {
      try {
        return readlinkSync(`/proc/${pid}/fd/${descriptor}`).endsWith('/dist/data/big.gpx');
      } catch {
        /* Closed between the listing and the readlink, which is the opposite of one being held. */
        return false;
      }
    }).length;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await abort(port, '/data/big.gpx');
  }

  /* Polled rather than slept on, so a leak is what fails this and a slow machine is not. */
  for (let waited = 0; waited < 2000 && held() > 0; waited += 50) {
    await new Promise((settle) => setTimeout(settle, 50));
  }

  expect(held()).toBe(0);

  /* The ordinary path still has to finish, destroying on `'close'` being easy to get wrong in the other direction. */
  const whole = await fetch(url('/data/big.gpx'));

  expect(whole.status).toBe(200);
  expect((await whole.arrayBuffer()).byteLength).toBe(ABORTABLE);
});

test('takes another port when one is busy rather than exiting', async () => {
  const first = await serve(workspace());
  const second = await serve(workspace());

  expect(second.port).not.toBe(first.port);
  expect((await fetch(second.url('/index.html'))).status).toBe(200);
  expect((await fetch(first.url('/index.html'))).status).toBe(200);
});

test('refuses a checkout with no dist, naming the command that builds one', async () => {
  const child = spawn(process.execPath, [SCRIPT], { cwd: workspace(false), stdio: ['ignore', 'pipe', 'pipe'] });
  running.push(child);

  const [code, stderr] = await new Promise<[number | null, string]>((resolve) => {
    let error = '';

    child.stderr.on('data', (chunk: Buffer) => {
      error += chunk.toString();
    });

    child.on('exit', (status) => resolve([status, error]));
  });

  expect(code).toBe(1);
  expect(stderr).toContain('dist/ does not exist');
  expect(stderr).toContain('pnpm build');
});
