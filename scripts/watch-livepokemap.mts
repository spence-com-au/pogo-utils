/**
 * Watches Live PokeMap the way an open tab would and pushes a notification to a phone through ntfy for each spawn one
 * of its queries wants. A query is a Live PokeMap display filter, one file each, as its own Export writes it or as the
 * Integrations page copies the shiny hunt.
 *
 * None of the secrets below is printed; nor is the token the login answers.
 *
 * Automated access is against Live PokeMap's terms and puts that account at risk, however closely this keeps to what
 * one tab does; the risk is the user's to weigh.
 *
 * Usage, from the repository root:
 *
 *   pnpm watch:livepokemap [OPTIONS] FILTER.json…
 *     Log in to Live PokeMap and push a notification through ntfy for each spawn a filter wants, in the foreground
 *     until stopped. A filter is a Live PokeMap display filter, as its own Export writes it or as the Integrations
 *     page copies the shiny hunt.
 *
 *     --verbose  print every request as it is sent and a line per poll
 *
 * Environment, which `.env` at the repository root can set instead, one set on the command line overriding it:
 *
 *   LPM_USERNAME, LPM_PASSWORD  the Live PokeMap account to log in as, both needed
 *   NTFY_TOPIC                  the ntfy topic to publish to, which anyone who knows it can read; unset, it runs
 *                               console only, printing each match in full rather than sending it
 *   NTFY_SERVER                 the ntfy server, `https://ntfy.sh` unless set
 *   NTFY_TOKEN                  an ntfy access token, for a server or topic that needs one
 *   LPM_BASE_URL                Live PokeMap itself, `https://play.livepokemap.com` unless set
 *
 * `help`, `--help` or `-h` prints this.
 */

import { LIVE_POKEMAP, LivePokeMap } from '../src/tools/watch/client.mts';
import { CONNECT_ATTEMPT_TIMEOUT, publishUrl } from '../src/tools/watch/ntfy.mts';
import { blindSpots, parseQuery, type Query } from '../src/tools/watch/query.mts';
import { messageOf, watch } from '../src/tools/watch/watcher.mts';
import { existsSync, readFileSync } from 'node:fs';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { parseArgs } from 'node:util';

/**
 * The synopsis out of this file's own header, as `inventory.mts` reads its own. Empty where the header no longer
 * matches, which `cli.test.mts` fails on.
 */
const USAGE =
  readFileSync(new URL(import.meta.url), 'utf8')
    .match(/Usage[^]*?(?=\n \*\/)/)?.[0]
    .replace(/^ \* ?/gm, '') ?? '';

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    verbose: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (options.help || positionals[0] === 'help') {
  console.log(USAGE);
  process.exit(0);
}

// Node gives each address family 250 ms to connect, which a single-homed ntfy.sh overruns from a slow link; see
// CONNECT_ATTEMPT_TIMEOUT for the measurement.
setDefaultAutoSelectFamilyAttemptTimeout(CONNECT_ATTEMPT_TIMEOUT);

const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const log = (line: string) => console.error(`${stamp()} ${line}`);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (positionals.length === 0) {
  fail(USAGE);
}

// A file keeps a password out of the shell's history; a variable already in the environment wins over the file.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const { LPM_USERNAME: username, LPM_PASSWORD: password, NTFY_TOPIC: topic } = process.env;
const missing = Object.entries({ LPM_USERNAME: username, LPM_PASSWORD: password })
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (!username || !password) {
  fail(`${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set\n${USAGE}`);
}

// No topic is console only: each match is printed rather than sent.
const ntfy = topic
  ? { server: process.env.NTFY_SERVER || 'https://ntfy.sh', topic, token: process.env.NTFY_TOKEN || undefined }
  : undefined;

// Checked here rather than left to the first publish, which would fail the same way for every match of every poll.
if (ntfy) {
  try {
    publishUrl(ntfy.server);
  } catch {
    fail(`NTFY_SERVER is not a URL: ${ntfy.server}`);
  }
}

const queries: Query[] = positionals.map((path) => {
  try {
    // Named by the path as typed rather than its base name, so that `a/shiny.json` and `b/shiny.json` stay two.
    return parseQuery(path, readFileSync(path, 'utf8'));
  } catch (error) {
    return fail((error as Error).message);
  }
});

for (const query of queries) {
  const blind = blindSpots(query.config);

  if (blind.length > 0) {
    log(`${query.name} also asks for ${blind.join(', ')}; the world view holds only 100% spawns and shinies`);
  }
}

const controller = new AbortController();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    log('Stopping');
    controller.abort();
  });
}

const client = new LivePokeMap(
  process.env.LPM_BASE_URL || LIVE_POKEMAP,
  { username, password },
  options.verbose ? (line) => log(line) : undefined,
);

try {
  await watch({
    client,
    ntfy,
    queries,
    signal: controller.signal,
    log,
    debug: options.verbose ? log : undefined,
  });
} catch (error) {
  if (!controller.signal.aborted) {
    fail(messageOf(error));
  }
}
