/**
 * Serves the built site over HTTP, which is how it is run locally: the pages reach `data/*.gpx` and the events feed
 * through `fetch`, and a browser denies a `file://` document those requests.
 *
 * A handler of its own rather than esbuild's `servedir`, which knows the types of the assets it bundles and offers no
 * way to extend the table: `events.ics` came out `text/plain`, so the Events page's Subscribe link opened as a text
 * page instead of reaching a calendar client — the one part of that page a local run could not check.
 *
 * Taking that over means taking on surviving a bad request. A `throw` inside a `createServer` listener is an uncaught
 * exception rather than a failed request, so it ends the process and every later request is refused by a port with
 * nothing behind it: `/%` used to kill the server through `decodeURIComponent`, and `/%00.html` through `statSync`. So
 * everything that reads a request or the filesystem answers with a value instead, and every file read sits behind a
 * stream whose `'error'` is handled.
 *
 * Only an extension in `src/served-types.mts` is served at all. A file in `dist/` with any other is not part of the
 * site — `scripts/assemble.mts` fails the build over one, against that same table — so 404 is both the true answer and
 * the only one that never has to guess a type.
 *
 * No `fallback` for deep links: `src/router.ts` reads the route out of the fragment, so `#/map` is a request for `/`.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, relative, resolve } from 'node:path';
import { SERVED_TYPES } from '../src/served-types.mts';
import { DIST } from '../src/generated.ts';

/**
 * Where to start looking for a port, and what esbuild's server bound before this, so the URL the README prints still
 * holds. It is where to *start* because esbuild moved to the next free port rather than failing, and with as many
 * worktrees as this repository carries a second `pnpm serve` is ordinary enough to keep that.
 */
const PORT = 8000;

/** How far past `PORT` to look, so a machine with the whole run busy says so rather than climbing forever. */
const PORT_TRIES = 10;

/*
 * `DIST` is the only servable tree there is: `index.html` names `src/main.css` and `src/main.js`, and the build writes
 * both rather than the checkout keeping them.
 *
 * A static server has no answer to a missing root but a 404 for every request, which reads as a site that loaded and
 * came up blank. Serving does not build — `pnpm build` is its own step — so an unbuilt or just-cleaned checkout is
 * exactly what this gets pointed at, and the whole of the difference is a sentence naming the command that fixes it.
 */
if (!existsSync(DIST)) {
  console.error(`${DIST}/ does not exist. Run \`pnpm build\` first.`);
  process.exit(1);
}

/** Absolute, because every request is resolved against it and then checked to have stayed inside it. */
const root = resolve(DIST);

/** Every answer that is not a file, which is every answer that has nothing in the table to be typed by. */
const answer = (response: ServerResponse, status: number, message: string) => {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(`${message}\n`);
};

/**
 * The file a request names and what to serve it as, or nothing where it names something this does not serve.
 *
 * Every throw a request can provoke is in here, and none of them needs a crafted request to reach:
 * `decodeURIComponent` throws `URIError` on a malformed escape such as `/%` or a truncated `/%E0%A4`, and `statSync`
 * throws `TypeError` on a path carrying a NUL byte and `EACCES` on one under a directory it cannot read —
 * `throwIfNoEntry: false` turning only `ENOENT` and `ENOTDIR` into `undefined` and nothing else. Answering all of them
 * with a value is what keeps a bad request from being a dead server.
 *
 * `new URL` drops a query string but leaves the path percent-encoded, which is what `decodeURIComponent` is for;
 * `resolve` then collapses the `..` segments a path can carry. The result is checked back against the root rather than
 * trusted — a `relative` that climbs is how `/../package.json` and its `%2e%2e` spelling are both refused, while a
 * `..` that stays inside still resolves — and that check comes before the stat, so a path outside `dist/` is never
 * touched rather than being stat'd and then rejected.
 */
const locate = (url: string): { file: string; type: string } | undefined => {
  try {
    const { pathname } = new URL(url, 'http://localhost');
    const wanted = decodeURIComponent(pathname);
    const file = resolve(root, `.${wanted.endsWith('/') ? `${wanted}index.html` : wanted}`);

    if (relative(root, file).startsWith('..')) {
      return undefined;
    }

    const type = SERVED_TYPES[extname(file)];

    if (type === undefined || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
      return undefined;
    }

    return { file, type };
  } catch {
    return undefined;
  }
};

const server = createServer((request, response) => {
  const located = locate(request.url ?? '/');

  if (located === undefined) {
    answer(response, 404, 'Not found');
    return;
  }

  if (request.method === 'HEAD') {
    response.writeHead(200, { 'content-type': located.type });
    response.end();
    return;
  }

  const stream = createReadStream(located.file);

  /*
   * `pipe` unpipes when its destination closes but does not destroy its source, so a client that goes away mid-body
   * would leave this open for good — one descriptor and one read buffer per abandoned request, which a stop button or
   * a reload during a GPX download is the ordinary way to reach. `'close'` fires on the normal end as well as the
   * aborted one, and destroying a stream that has already ended is a no-op, so this needs no condition.
   *
   * `pipeline()` would also do it, but it wants the head written before the pipe starts and so would undo the
   * `'open'` ordering below.
   */
  response.once('close', () => stream.destroy());

  /*
   * The head is written on `'open'` rather than ahead of it, so a file that passed the stat and then could not be
   * opened still gets a status of its own. That race is this repository's own documented loop rather than anything
   * exotic: `pnpm build` opens with `rm -rf dist`, and a browser reload in the second it takes lands here with the
   * file already gone.
   */
  stream.once('open', () => {
    response.writeHead(200, { 'content-type': located.type });
    stream.pipe(response);
  });

  /*
   * Once a head has gone out the status is committed, so a failure after that can only cut the response short and let
   * the client see a truncated body. Before it, there is still a 500 to be had.
   */
  stream.once('error', () => {
    if (response.headersSent) {
      response.destroy();
      return;
    }

    answer(response, 500, 'Could not read file');
  });
});

let port = PORT;

/*
 * A busy port is not a failure while one is still being chosen, which is what `listening` separates: after the server
 * is up there is no next port to try, so anything arriving then is reported and the process ends on it rather than
 * printing a stack trace in a file that explains its one other failure in a sentence.
 */
server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE' && !server.listening && port < PORT + PORT_TRIES) {
    port += 1;
    server.listen(port);
    return;
  }

  console.error(`Cannot serve ${DIST}/ on port ${port}: ${error.message}`);
  process.exit(1);
});

server.once('listening', () => {
  const address = server.address();

  /* Read back off the server rather than interpolated, since a retry above means `PORT` is not what is listening. */
  const bound = typeof address === 'object' && address !== null ? address.port : port;

  /*
   * Every IPv4 address rather than the loopback alone, loopback first: a LAN one is how the site is opened on a phone,
   * which is the only way to see it on the kind of device `manifest.json` is written for.
   */
  const addresses = Object.values(networkInterfaces())
    .flatMap((interfaces) => interfaces ?? [])
    .filter((entry) => entry.family === 'IPv4')
    .sort((left, right) => Number(right.internal) - Number(left.internal))
    .map((entry) => `http://${entry.address}:${bound}/`);

  console.log(`Serving ${DIST}/ at ${addresses.join(' ')}`);
});

server.listen(port);
