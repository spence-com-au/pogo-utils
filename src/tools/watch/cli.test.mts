/**
 * The command end to end, run as a subprocess the way a person runs it, against stand-ins for Live PokeMap and ntfy on
 * the loopback interface. What is asserted is what #189 asks of it: every request it sends and in what order, that
 * none of them writes, one viewport per poll whatever the number of queries, a login again when the token is refused,
 * one notification per spawn however many polls carry it, and no secret in anything it prints.
 *
 * Real time rather than a fake clock, the command being a separate process: the server's refresh is asked as 1 second
 * and the command holds it to the page's floor of 5, so three polls take ten seconds. A refused poll's backoff is
 * driven in-process below instead, where the wait can be recorded rather than sat through.
 */

import { LivePokeMap, LoginRefused } from './client.mts';
import { parseQuery } from './query.mts';
import { PUBLISH_TIMEOUT } from './ntfy.mts';
import { NOTIFY_ATTEMPTS, watch } from './watcher.mts';
import { ApiError, type ViewportResponse, type WireSpawn } from './wire.mts';
import { spawn as run } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../scripts/watch-livepokemap.mts', import.meta.url));
const fixturePath = (name: string) => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
const fixture = (name: string) => readFileSync(fixturePath(name), 'utf8');

// The command reads a `.env` in the directory it runs from, so every run below is given one of its own or none at all
// rather than the repository root's, which is a developer's real credentials.
const NO_ENV = fixturePath('');

const PASSWORD = 'correct horse battery staple';
const TOKENS = ['eyJ.first-token.sig', 'eyJ.second-token.sig'];

interface Seen {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: unknown;
  at: number;
}

/** A server answering with `answer`, recording every request it was sent. */
async function standIn(answer: (request: Seen, response: ServerResponse) => void) {
  const requests: Seen[] = [];
  const server: Server = createServer((request, response) => {
    // Decoded once, whole: a chunk decoded on its own splits any character straddling its edge, and a species name like
    // `Nidoran♀` or `Flabébé` is the reason `ntfy.mts` sends JSON at all.
    void text(request).then((body) => {
      const seen = {
        method: request.method ?? '',
        path: request.url ?? '',
        headers: request.headers,
        body: body ? JSON.parse(body) : undefined,
        at: Date.now(),
      };

      requests.push(seen);
      answer(seen, response);
    });
  });

  await new Promise<void>((listening) => void server.listen(0, '127.0.0.1', listening));

  return {
    requests,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise((closed) => server.close(closed)),
  };
}

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
};

/** The fixture with its spawns live for ten minutes, and `extra` added to the 100% list. */
function viewport(extra: WireSpawn[] = []): ViewportResponse {
  const answer = JSON.parse(fixture('viewport.json')) as ViewportResponse;
  const live = (spawn: WireSpawn) => ({ ...spawn, despawn_ms: Date.now() + 10 * 60_000 });

  return {
    ...answer,
    pokemon: [...(answer.pokemon ?? []), ...extra].map(live),
    my_shiny_pokemon: answer.my_shiny_pokemon?.map(live),
  };
}

const LARVITAR: WireSpawn = {
  encounter_id: '9100000000000000006',
  dex_id: 246,
  pokemon_name: 'Larvitar',
  lat: 1.283,
  lon: 103.86,
  cp: 671,
  level: 27,
  iv_attack: 15,
  iv_defense: 15,
  iv_stamina: 15,
  iv_percent: 100,
};

test('polls once per interval, logs in again when refused, writes nothing and notifies each spawn once', async () => {
  let logins = 0;
  let viewports = 0;

  const map = await standIn((request, response) => {
    const token = (request.headers.authorization ?? '').replace(/^Bearer /, '');

    switch (`${request.method} ${request.path}`) {
      case 'GET /api/config':
        return json(response, 200, { ...JSON.parse(fixture('config.json')), viewport_refresh_seconds: 1 });
      case 'GET /api/game_data':
        return json(response, 200, JSON.parse(fixture('game-data.json')));
      case 'POST /api/auth/login':
        return json(response, 200, { token: TOKENS[logins++], user: { username: 'watcher' } });
      case 'GET /api/auth/me':
      case 'GET /api/session/status':
        return json(response, 200, { success: true, data: {} });
      case 'POST /api/map/viewport':
        viewports += 1;

        // The second poll finds the first token expired; the third poll turns up one spawn more.
        if (token !== TOKENS[logins - 1] || (viewports === 2 && logins === 1)) {
          return json(response, 401, { success: false, error: { code: 'UNAUTHORIZED', message: 'Token expired' } });
        }

        return json(response, 200, viewport(viewports >= 4 ? [LARVITAR] : []));
      default:
        return json(response, 404, { success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
    }
  });
  const ntfy = await standIn((_request, response) => json(response, 200, { id: 'x' }));

  const child = run(process.execPath, [SCRIPT, fixturePath('shiny-hunt.json'), fixturePath('xxl.json')], {
    cwd: NO_ENV,
    env: {
      ...process.env,
      LPM_BASE_URL: map.url,
      LPM_USERNAME: 'watcher',
      LPM_PASSWORD: PASSWORD,
      NTFY_SERVER: ntfy.url,
      NTFY_TOPIC: 'secret-topic-name',
      TZ: 'UTC',
    },
  });

  let output = '';

  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));

  const exited = new Promise<number | null>((done) => child.on('exit', done));

  try {
    // Four viewport requests: the first poll, the refused second and its retry, and the third poll.
    for (let waited = 0; viewports < 4 || ntfy.requests.length < 5; waited += 100) {
      expect(waited, `still waiting on the polls; it printed:\n${output}`).toBeLessThan(30_000);
      await new Promise((tick) => setTimeout(tick, 100));
    }

    child.kill('SIGINT');
    expect(await exited, output).toBe(0);
  } finally {
    child.kill('SIGKILL');
    await map.close();
    await ntfy.close();
  }

  expect(map.requests.map((request) => `${request.method} ${request.path}`)).toStrictEqual([
    'GET /api/config',
    'GET /api/game_data',
    'POST /api/auth/login',
    'GET /api/auth/me',
    'GET /api/session/status',
    'POST /api/map/viewport',
    'POST /api/map/viewport',
    'POST /api/auth/login',
    'POST /api/map/viewport',
    'POST /api/map/viewport',
  ]);

  // A refused token is answered at once — a login and the same viewport again — rather than at the next poll.
  const [refused = 0, again = Infinity, retried = Infinity] = map.requests.slice(6, 9).map((request) => request.at);

  expect(again - refused).toBeLessThan(1000);
  expect(retried - refused).toBeLessThan(1000);

  // The server's 1s refresh is held to the page's 5s floor between one poll and the next: the first and the refused
  // second, then the second's retry and the third. Neither the raw second nor none at all, and not the 15s default a
  // config without the field gets either.
  const at = (index: number) => map.requests[index]?.at ?? NaN;

  for (const [from, to] of [
    [5, 6],
    [8, 9],
  ] as const) {
    expect(at(to) - at(from)).toBeGreaterThanOrEqual(4_900);
    expect(at(to) - at(from)).toBeLessThan(9_000);
  }

  // The login carries the credentials the environment gave it, and nothing after it does.
  expect(map.requests[2]?.body).toStrictEqual({ username: 'watcher', password: PASSWORD });

  // Each request reads as the page's, and each after a login carries that login's token.
  for (const request of map.requests) {
    expect(request.headers['user-agent']).toMatch(/Chrome\//);
    expect(request.headers['sec-fetch-site']).toBe('same-origin');
  }

  expect(map.requests.slice(3, 7).map((request) => request.headers.authorization)).toStrictEqual(
    Array(4).fill(`Bearer ${TOKENS[0]}`),
  );
  expect(map.requests.slice(8).map((request) => request.headers.authorization)).toStrictEqual(
    Array(2).fill(`Bearer ${TOKENS[1]}`),
  );

  // One viewport for two queries, of the whole world, wide enough for both.
  const body = map.requests[5]?.body as { display_filters: Record<string, unknown> } & Record<string, unknown>;

  expect(body).toMatchObject({ min_lat: -85, max_lat: 85, min_lon: -180, max_lon: 180, zoom: 0 });
  expect(body.display_filters).toMatchObject({
    species_filter_mode: 'allowlist',
    species_filter_list: [1, 19, 129],
    always_show_perfect: true,
    show_my_shinies: true,
  });

  // Four spawns on the first poll, none again on the next two, and the one the third poll added.
  const sent = ntfy.requests.map((request) => request.body as { topic: string; title: string; message: string });

  expect(sent.map((notification) => notification.title)).toStrictEqual([
    '100% Dratini',
    '100% XXL Magikarp',
    'Shiny 100% Rattata (Alola)',
    'Shiny Bulbasaur',
    '100% Larvitar',
  ]);
  expect(new Set(sent.map((notification) => notification.topic))).toStrictEqual(new Set(['secret-topic-name']));
  expect(sent[0]?.message).toMatch(
    /^IV 15\/15\/15 \(100%\) · CP 1009 · L30\nDespawns \d\d:\d\d \(10 min left\)\n35\.658581,139\.745433$/,
  );

  // Nothing secret is printed: not the password, not either token, not the topic.
  for (const secret of [PASSWORD, ...TOKENS, 'secret-topic-name']) {
    expect(output).not.toContain(secret);
  }

  expect(output).toContain('shiny-hunt.json also asks for spawns from 0% to 99% IV');
  expect(output).toContain('First poll: 3 spawns and 2 shinies, with shiny access');
}, 60_000);

/**
 * The options the long run above leaves out: `NTFY_TOKEN` reaches the publish as a bearer header, and nowhere else, and
 * `--verbose` prints each request and a line per poll.
 */
test('NTFY_TOKEN is sent to ntfy as a bearer token and --verbose prints every request', async () => {
  const NTFY_TOKEN = 'tk_ntfy-access-token';

  const map = await standIn((request, response) => {
    switch (`${request.method} ${request.path}`) {
      case 'GET /api/config':
        return json(response, 200, JSON.parse(fixture('config.json')));
      case 'GET /api/game_data':
        return json(response, 200, JSON.parse(fixture('game-data.json')));
      case 'POST /api/auth/login':
        return json(response, 200, { token: TOKENS[0] });
      case 'POST /api/map/viewport':
        return json(response, 200, viewport());
      default:
        return json(response, 200, { success: true, data: {} });
    }
  });
  const ntfy = await standIn((_request, response) => json(response, 200, { id: 'x' }));

  const child = run(process.execPath, [SCRIPT, '--verbose', fixturePath('shiny-hunt.json')], {
    cwd: NO_ENV,
    env: {
      ...process.env,
      LPM_BASE_URL: map.url,
      LPM_USERNAME: 'watcher',
      LPM_PASSWORD: PASSWORD,
      NTFY_SERVER: ntfy.url,
      NTFY_TOPIC: 'secret-topic-name',
      NTFY_TOKEN,
      TZ: 'UTC',
    },
  });

  let output = '';

  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));

  const exited = new Promise<number | null>((done) => child.on('exit', done));

  try {
    // The first poll's four spawns are four notifications, and its verbose line comes before the first of them.
    for (let waited = 0; ntfy.requests.length < 4; waited += 100) {
      expect(waited, `still waiting on the first poll; it printed:\n${output}`).toBeLessThan(30_000);
      await new Promise((tick) => setTimeout(tick, 100));
    }

    child.kill('SIGINT');
    expect(await exited, output).toBe(0);
  } finally {
    child.kill('SIGKILL');
    await map.close();
    await ntfy.close();
  }

  expect(ntfy.requests.map((request) => request.headers.authorization)).toStrictEqual(
    Array(4).fill(`Bearer ${NTFY_TOKEN}`),
  );

  // Live PokeMap never hears the ntfy token.
  expect(map.requests.map((request) => request.headers.authorization)).not.toContain(`Bearer ${NTFY_TOKEN}`);

  expect(output).toContain('POST /api/auth/login');
  expect(output).toContain('POST /api/map/viewport');
  expect(output).toMatch(/\d+ spawns, \d+ shinies, \d+ wanted/);

  for (const secret of [PASSWORD, NTFY_TOKEN, ...TOKENS, 'secret-topic-name']) {
    expect(output).not.toContain(secret);
  }
}, 60_000);

test.each([['--help'], ['-h'], ['help']])(
  '%s prints the usage and exits cleanly, needing no credentials',
  async (arg) => {
    const child = run(process.execPath, [SCRIPT, arg], {
      cwd: NO_ENV,
      env: { ...process.env, LPM_USERNAME: '', LPM_PASSWORD: '' },
    });
    const exited = new Promise<number | null>((done) => child.on('exit', done));

    expect(await text(child.stdout)).toMatch(
      /^Usage, from the repository root:\n\n {2}pnpm watch:livepokemap \[OPTIONS\] FILTER\.json…\n/,
    );
    expect(await exited).toBe(0);
  },
);

test('a refused or failed poll waits out a growing backoff rather than the interval, and carries on', async () => {
  let viewports = 0;

  const map = await standIn((request, response) => {
    switch (`${request.method} ${request.path}`) {
      case 'POST /api/auth/login':
        return json(response, 200, { token: 't' });
      case 'POST /api/map/viewport':
        viewports += 1;

        if (viewports <= 3) {
          return json(response, viewports === 2 ? 429 : 502, {
            success: false,
            error: { code: viewports === 2 ? 'RATE_LIMITED' : 'BRIDGE_ERROR', message: 'Try later' },
          });
        }

        return json(response, 200, { span_tier: 'perfect', pokemon: [], my_shiny_pokemon: [] });
      default:
        return json(response, 200, {});
    }
  });

  const controller = new AbortController();
  const waits: number[] = [];
  const lines: string[] = [];

  try {
    await watch({
      client: new LivePokeMap(map.url, { username: 'u', password: 'p' }),
      ntfy: { server: 'http://127.0.0.1:9', topic: 't' },
      queries: [parseQuery('shiny-hunt.json', fixture('shiny-hunt.json'))],
      signal: controller.signal,
      log: (line) => lines.push(line),
      random: () => 0.5,
      sleep: async (ms) => {
        waits.push(ms);

        if (waits.length === 5) {
          controller.abort();
        }
      },
    });
  } finally {
    await map.close();
  }

  // Three failures, doubling from twice the interval, then back to the interval once it answers.
  expect(waits).toStrictEqual([30_000, 60_000, 120_000, 15_000, 15_000]);
  expect(lines.filter((line) => line.includes('trying again'))).toHaveLength(3);
});

test('a login the server refuses is not retried', async () => {
  const map = await standIn((request, response) =>
    request.path === '/api/auth/login'
      ? json(response, 401, {
          success: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' },
        })
      : json(response, 200, {}),
  );

  const controller = new AbortController();
  let waits = 0;

  try {
    await expect(
      watch({
        client: new LivePokeMap(map.url, { username: 'u', password: 'p' }),
        ntfy: { server: 'http://127.0.0.1:9', topic: 't' },
        queries: [parseQuery('shiny-hunt.json', fixture('shiny-hunt.json'))],
        signal: controller.signal,
        log: () => {},
        sleep: async () => {
          // A safety net, so that a regression fails here rather than hanging the suite.
          if (++waits > 5) {
            controller.abort();
          }
        },
      }),
    ).rejects.toThrow('Live PokeMap refused the login');
  } finally {
    await map.close();
  }

  expect(map.requests.filter((request) => request.path === '/api/auth/login')).toHaveLength(1);
});

/**
 * A login answered 200 without a token it can use is no refusal: nothing says the credentials are wrong, so it is an
 * `ApiError` carrying the 200 rather than a `LoginRefused`, and the watcher waits it out instead of stopping for good.
 * Three shapes, being three different ways upstream could change under it.
 */
test.each([
  ['no token at all', { user: { username: 'u' } }],
  ['a token that is not a string', { token: 42 }],
  ['an empty token', { token: '' }],
])('a login answered with %s is an error to wait out, not a refusal', async (_, answer) => {
  const map = await standIn((_request, response) => json(response, 200, answer));
  const client = new LivePokeMap(map.url, { username: 'u', password: 'p' });
  let error: unknown;

  try {
    await client.login().catch((thrown: unknown) => (error = thrown));
  } finally {
    await map.close();
  }

  expect(error).toBeInstanceOf(ApiError);
  expect(error).not.toBeInstanceOf(LoginRefused);
  expect(error).toMatchObject({ status: 200, message: 'the login answered no token' });
  expect(client.loggedIn).toBe(false);
});

/**
 * A 200 that is not JSON — a Cloudflare challenge, a maintenance page — is a failure to wait out like any other, not an
 * answer: at start it would otherwise reach `refreshInterval` as `null` and end the command outside every retry.
 */
test('a 200 that is not JSON is retried at start rather than taken for an answer', async () => {
  let configs = 0;

  const map = await standIn((request, response) => {
    if (request.path === '/api/config' && ++configs === 1) {
      response.writeHead(200, { 'Content-Type': 'text/html' });

      return response.end('<html>Just a moment...</html>');
    }

    return request.path === '/api/auth/login' ? json(response, 200, { token: 't' }) : json(response, 200, {});
  });

  const controller = new AbortController();
  const lines: string[] = [];
  let waits = 0;

  try {
    await watch({
      client: new LivePokeMap(map.url, { username: 'u', password: 'p' }),
      ntfy: { server: 'http://127.0.0.1:9', topic: 't' },
      queries: [parseQuery('shiny-hunt.json', fixture('shiny-hunt.json'))],
      signal: controller.signal,
      log: (line) => lines.push(line),
      random: () => 0.5,

      // The first wait is the retry at start, the second the interval after a first poll that start reached.
      sleep: async () => {
        if (++waits === 2) {
          controller.abort();
        }
      },
    });
  } finally {
    await map.close();
  }

  expect(waits).toBe(2);
  expect(configs).toBe(2);
  expect(lines[0]).toBe(
    'Could not read /api/config: GET /api/config: 200 with a body that is not JSON; trying again in 30s',
  );
});

test.each([
  ['/api/config', null],
  ['/api/config', { success: true, data: null }],
  ['/api/game_data', null],
  ['/api/game_data', { success: true, data: null }],
])('%s answered with %j is a failure to wait out, not an answer', async (path, answer) => {
  const map = await standIn((_request, response) => json(response, 200, answer));
  const client = new LivePokeMap(map.url, { username: 'u', password: 'p' });
  let error: unknown;

  try {
    await (path === '/api/config' ? client.config() : client.gameData()).catch((thrown: unknown) => (error = thrown));
  } finally {
    await map.close();
  }

  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ status: 200, message: `GET ${path}: 200 with no object in its body` });
});

/**
 * A refusal hours in — a password changed while it ran — stops the watcher as one at start does. A 401 on a poll is
 * answered with a login, and that login refused is not sent again: retried at the backoff's pace it would be the same
 * bad credentials every fifteen minutes, all night.
 */
test('a re-login refused partway through a run stops the watcher rather than retrying it', async () => {
  let logins = 0;

  const map = await standIn((request, response) => {
    switch (`${request.method} ${request.path}`) {
      case 'POST /api/auth/login':
        logins += 1;

        return logins === 1
          ? json(response, 200, { token: 't' })
          : json(response, 401, {
              success: false,
              error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' },
            });
      case 'POST /api/map/viewport':
        return json(response, 401, { success: false, error: { code: 'UNAUTHORIZED', message: 'Token expired' } });
      default:
        return json(response, 200, {});
    }
  });

  const controller = new AbortController();
  let waits = 0;

  try {
    await expect(
      watch({
        client: new LivePokeMap(map.url, { username: 'u', password: 'p' }),
        ntfy: { server: 'http://127.0.0.1:9', topic: 't' },
        queries: [parseQuery('shiny-hunt.json', fixture('shiny-hunt.json'))],
        signal: controller.signal,
        log: () => {},
        sleep: async () => {
          // A safety net, so that a regression fails here rather than hanging the suite.
          if (++waits > 5) {
            controller.abort();
          }
        },
      }),
    ).rejects.toThrow('Live PokeMap refused the login');
  } finally {
    await map.close();
  }

  expect(logins).toBe(2);
});

/**
 * Without ntfy it runs console only: a match is printed in full, the place as a link, and printed once however many
 * polls carry it — the same once that a notification gets.
 */
test('without ntfy each match is printed once, in full, and nothing is sent', async () => {
  const map = await standIn((request, response) => {
    switch (`${request.method} ${request.path}`) {
      case 'GET /api/game_data':
        return json(response, 200, JSON.parse(fixture('game-data.json')));
      case 'POST /api/auth/login':
        return json(response, 200, { token: 't' });
      case 'POST /api/map/viewport':
        return json(response, 200, viewport());
      default:
        return json(response, 200, {});
    }
  });

  const controller = new AbortController();
  const lines: string[] = [];
  let polls = 0;

  try {
    await watch({
      client: new LivePokeMap(map.url, { username: 'u', password: 'p' }),
      queries: [parseQuery('shiny-hunt.json', fixture('shiny-hunt.json'))],
      signal: controller.signal,
      log: (line) => lines.push(line),
      sleep: async () => {
        if (++polls === 2) {
          controller.abort();
        }
      },
    });
  } finally {
    await map.close();
  }

  expect(lines).toContain('Watching the world every 15s for 1 query, console only (NTFY_TOPIC is not set)');

  // Two polls carrying the same four spawns, each printed once.
  expect(lines.filter((line) => line.startsWith('Found '))).toStrictEqual([
    'Found 100% Dratini (shiny-hunt.json)',
    'Found 100% XXL Magikarp (shiny-hunt.json)',
    'Found Shiny 100% Rattata (Alola) (shiny-hunt.json)',
    'Found Shiny Bulbasaur (shiny-hunt.json)',
  ]);

  const bulbasaur = lines.indexOf('Found Shiny Bulbasaur (shiny-hunt.json)');

  expect(lines.slice(bulbasaur + 1, bulbasaur + 5)).toStrictEqual([
    '  IV 10/12/8 (66.7%) · CP 512 · L20',
    expect.stringMatching(/^ {2}Despawns \d\d:\d\d \(10 min left\)$/),
    '  40.782865,-73.965355',
    '  https://www.google.com/maps/search/?api=1&query=40.782865,-73.965355',
  ]);
});

/**
 * A spawn the server gives no despawn time is remembered for an hour, longer than any spawn lasts: forgotten sooner, a
 * spawn still there is said again; never forgotten, one met again later is not said at all.
 */
test('a spawn with no despawn time is said once, and again only once an hour has passed', async () => {
  const map = await standIn((request, response) => {
    switch (`${request.method} ${request.path}`) {
      case 'POST /api/auth/login':
        return json(response, 200, { token: 't' });
      case 'POST /api/map/viewport':
        // `LARVITAR` carries no `despawn_ms`, and nothing here adds one.
        return json(response, 200, { span_tier: 'perfect', pokemon: [LARVITAR] });
      default:
        return json(response, 200, {});
    }
  });

  const controller = new AbortController();
  const said: string[] = [];
  const start = Date.now();
  let time = start;

  // The clock at the second poll and the third: a millisecond short of the hour, then the hour.
  const clock = [start + 60 * 60_000 - 1, start + 60 * 60_000];

  try {
    await watch({
      client: new LivePokeMap(map.url, { username: 'u', password: 'p' }),
      queries: [parseQuery('shiny-hunt.json', fixture('shiny-hunt.json'))],
      signal: controller.signal,
      log: (line) => said.push(line),
      now: () => time,
      sleep: async () => {
        said.push('(slept)');

        const next = clock.shift();

        if (next === undefined) {
          controller.abort();
        } else {
          time = next;
        }
      },
    });
  } finally {
    await map.close();
  }

  expect(said.filter((line) => line.startsWith('Found ') || line === '(slept)')).toStrictEqual([
    'Found 100% Larvitar (shiny-hunt.json)',
    '(slept)',
    '(slept)',
    'Found 100% Larvitar (shiny-hunt.json)',
    '(slept)',
  ]);

  expect(said).toContain('  Despawn time unknown');
});

/**
 * A spawn without a dex number is the feed changing shape, and a watcher that only dropped it would read as one with
 * nothing to find. Said when it starts, and again when it starts over, rather than on every poll it lasts.
 */
test('spawns without a dex number are said each time they start arriving', async () => {
  let viewports = 0;

  const map = await standIn((request, response) => {
    switch (`${request.method} ${request.path}`) {
      case 'POST /api/auth/login':
        return json(response, 200, { token: 't' });
      case 'POST /api/map/viewport':
        viewports += 1;

        // Every poll but the third carries Larvitar with no `dex_id` at all, as a renamed field would arrive.
        return json(response, 200, viewport(viewports === 3 ? [] : [{ ...LARVITAR, dex_id: undefined }]));
      default:
        return json(response, 200, {});
    }
  });

  const controller = new AbortController();
  const lines: string[] = [];

  try {
    await watch({
      client: new LivePokeMap(map.url, { username: 'u', password: 'p' }),
      queries: [parseQuery('shiny-hunt.json', fixture('shiny-hunt.json'))],
      signal: controller.signal,
      log: (line) => lines.push(line),
      sleep: async () => {
        if (viewports === 4) {
          controller.abort();
        }
      },
    });
  } finally {
    await map.close();
  }

  expect(lines.filter((line) => line.includes('dex number'))).toStrictEqual([
    'The server answered 1 spawn without a dex number, which no query can want',
    'The server answered 1 spawn without a dex number, which no query can want',
  ]);
});

/**
 * The span tier is the only check there is that `WORLD` is wide enough, so an answer without one is said as any other
 * tier short of `perfect` is: on the first poll that carries it, and again only when it comes back.
 */
test('an answer without a span tier is said, from the first poll on', async () => {
  let viewports = 0;

  const map = await standIn((request, response) => {
    switch (`${request.method} ${request.path}`) {
      case 'POST /api/auth/login':
        return json(response, 200, { token: 't' });
      case 'POST /api/map/viewport':
        viewports += 1;

        // Every poll but the third without the field at all, as a server that stopped sending it would answer: the JSON
        // leaves out a member that is `undefined`.
        return json(response, 200, viewports === 3 ? viewport() : { ...viewport(), span_tier: undefined });
      default:
        return json(response, 200, {});
    }
  });

  const controller = new AbortController();
  const lines: string[] = [];

  try {
    await watch({
      client: new LivePokeMap(map.url, { username: 'u', password: 'p' }),
      queries: [parseQuery('shiny-hunt.json', fixture('shiny-hunt.json'))],
      signal: controller.signal,
      log: (line) => lines.push(line),
      sleep: async () => {
        if (viewports === 4) {
          controller.abort();
        }
      },
    });
  } finally {
    await map.close();
  }

  expect(lines.filter((line) => line.includes('span tier'))).toStrictEqual([
    'The server answered no span tier, where the world view expects "perfect"',
    'The server answered no span tier, where the world view expects "perfect"',
  ]);
});

/**
 * The line a failed notification prints is the whole of what a watcher left running overnight leaves behind, and
 * `fetch` calls everything below HTTP `fetch failed` — so unless the cause reaches the log the failure names nothing to
 * act on. Port 9 is one `fetch` refuses itself, which makes the cause here `bad port` rather than the network's to
 * decide.
 */
test('a notification that cannot be sent says why, cause and all', async () => {
  const map = await standIn((request, response) => {
    switch (`${request.method} ${request.path}`) {
      case 'GET /api/game_data':
        return json(response, 200, JSON.parse(fixture('game-data.json')));
      case 'POST /api/auth/login':
        return json(response, 200, { token: 't' });
      case 'POST /api/map/viewport':
        return json(response, 200, viewport());
      default:
        return json(response, 200, {});
    }
  });

  const controller = new AbortController();
  const lines: string[] = [];

  try {
    await watch({
      client: new LivePokeMap(map.url, { username: 'u', password: 'p' }),
      ntfy: { server: 'http://127.0.0.1:9', topic: 'secret-topic-name' },
      queries: [parseQuery('shiny-hunt.json', fixture('shiny-hunt.json'))],
      signal: controller.signal,
      log: (line) => lines.push(line),
      random: () => 0.5,
      sleep: async () => controller.abort(),
    });
  } finally {
    await map.close();
  }

  expect(lines.filter((line) => line.startsWith('Could not notify'))).toStrictEqual([
    'Could not notify 100% Dratini: fetch failed: bad port; trying again in 30s',
    'Could not notify 100% XXL Magikarp: fetch failed: bad port; trying again in 30s',
    'Could not notify Shiny 100% Rattata (Alola): fetch failed: bad port; trying again in 30s',
    'Could not notify Shiny Bulbasaur: fetch failed: bad port; trying again in 30s',
  ]);

  // A publish carries the topic in its body and never in its URL, so no failure of one can print it.
  expect(lines.join('\n')).not.toContain('secret-topic-name');
});

/**
 * An ntfy refusing every publish is backed off from as a refused viewport is, and each spawn is given up on after
 * `NOTIFY_ATTEMPTS` polls rather than re-sent for as long as it lives — which at the poll rate is how a 429 becomes a
 * ban.
 */
test('a refused notification backs the poll off, and is given up on after a bounded number of attempts', async () => {
  const map = await standIn((request, response) => {
    switch (`${request.method} ${request.path}`) {
      case 'GET /api/game_data':
        return json(response, 200, JSON.parse(fixture('game-data.json')));
      case 'POST /api/auth/login':
        return json(response, 200, { token: 't' });
      case 'POST /api/map/viewport':
        return json(response, 200, viewport());
      default:
        return json(response, 200, {});
    }
  });
  const ntfy = await standIn((_request, response) => json(response, 429, { error: 'limit reached' }));

  const controller = new AbortController();
  const waits: number[] = [];
  const lines: string[] = [];

  try {
    await watch({
      client: new LivePokeMap(map.url, { username: 'u', password: 'p' }),
      ntfy: { server: ntfy.url, topic: 't' },
      queries: [parseQuery('shiny-hunt.json', fixture('shiny-hunt.json'))],
      signal: controller.signal,
      log: (line) => lines.push(line),
      random: () => 0.5,
      sleep: async (ms) => {
        waits.push(ms);

        if (waits.length === NOTIFY_ATTEMPTS + 2) {
          controller.abort();
        }
      },
    });
  } finally {
    await map.close();
    await ntfy.close();
  }

  // Four spawns, each tried on three polls and then left alone, so the two polls after them send nothing and are back
  // at the interval.
  expect(ntfy.requests).toHaveLength(4 * NOTIFY_ATTEMPTS);
  expect(waits).toStrictEqual([30_000, 60_000, 120_000, 15_000, 15_000]);
  const refused = `ntfy at ${new URL(ntfy.url).host} answered 429 Too Many Requests`;

  expect(lines.filter((line) => line.includes('giving up'))).toStrictEqual(
    ['100% Dratini', '100% XXL Magikarp', 'Shiny 100% Rattata (Alola)', 'Shiny Bulbasaur'].map(
      (title) => `Could not notify ${title}: ${refused}; giving up after 3 attempts`,
    ),
  );
});

/**
 * An ntfy that takes a publish and never answers costs a poll one `PUBLISH_TIMEOUT` however many spawns are waiting on
 * it, rather than holding the loop until the server gives up or, sent one at a time, a timeout per spawn.
 */
test(
  "a notification that is never answered times out, all of a poll's at once",
  async () => {
    const map = await standIn((request, response) => {
      switch (`${request.method} ${request.path}`) {
        case 'GET /api/game_data':
          return json(response, 200, JSON.parse(fixture('game-data.json')));
        case 'POST /api/auth/login':
          return json(response, 200, { token: 't' });
        case 'POST /api/map/viewport':
          return json(response, 200, viewport());
        default:
          return json(response, 200, {});
      }
    });
    const hung: ServerResponse[] = [];
    const ntfy = await standIn((_request, response) => void hung.push(response));

    const controller = new AbortController();
    const lines: string[] = [];
    const started = Date.now();

    try {
      await watch({
        client: new LivePokeMap(map.url, { username: 'u', password: 'p' }),
        ntfy: { server: ntfy.url, topic: 't' },
        queries: [parseQuery('shiny-hunt.json', fixture('shiny-hunt.json'))],
        signal: controller.signal,
        log: (line) => lines.push(line),
        random: () => 0.5,
        sleep: async () => controller.abort(),
      });
    } finally {
      for (const response of hung) {
        response.destroy();
      }

      await map.close();
      await ntfy.close();
    }

    expect(Date.now() - started).toBeLessThan(2 * PUBLISH_TIMEOUT);
    expect(lines.filter((line) => line.startsWith('Could not notify'))).toHaveLength(4);
    expect(lines.filter((line) => line.includes('timeout'))).toHaveLength(4);
  },
  4 * PUBLISH_TIMEOUT,
);

test('the command refuses to start without its credentials, a query or an ntfy server it can parse', async () => {
  const start = (args: string[], env: Record<string, string>) =>
    new Promise<[number | null, string]>((done) => {
      const child = run(process.execPath, [SCRIPT, ...args], {
        cwd: NO_ENV,
        env: { PATH: process.env.PATH ?? '', ...env },
      });
      let output = '';

      child.stderr.on('data', (chunk) => (output += chunk));
      child.on('exit', (code) => done([code, output]));
    });

  const [noQuery] = await start([], { LPM_USERNAME: 'u', LPM_PASSWORD: 'p', NTFY_TOPIC: 't' });
  const [noPassword, said] = await start([fixturePath('shiny-hunt.json')], { LPM_USERNAME: 'u', NTFY_TOPIC: 't' });
  const [notFilter, why] = await start([fixturePath('config.json')], {
    LPM_USERNAME: 'u',
    LPM_PASSWORD: 'p',
    NTFY_TOPIC: 't',
  });

  // Live PokeMap on a port `fetch` refuses, so a check that let the server through would fail at the login instead.
  const [noScheme, because] = await start([fixturePath('shiny-hunt.json')], {
    LPM_USERNAME: 'u',
    LPM_PASSWORD: 'p',
    LPM_BASE_URL: 'http://127.0.0.1:9',
    NTFY_TOPIC: 't',
    NTFY_SERVER: 'ntfy.example.com',
  });

  expect(noQuery).toBe(1);
  expect([noPassword, said]).toStrictEqual([1, expect.stringContaining('LPM_PASSWORD is not set')]);
  expect([notFilter, why]).toStrictEqual([
    1,
    expect.stringContaining('config.json: not a Live PokeMap display filter'),
  ]);
  expect([noScheme, because]).toStrictEqual([1, expect.stringContaining('NTFY_SERVER is not a URL: ntfy.example.com')]);
});

/**
 * A `.env` is where a password belongs rather than a shell's history, read from the directory the command runs in —
 * `pnpm` runs a script from the repository root. Here the file is the only source of the password and of the server to
 * reach, so a login at all is the proof it was read, while the username it carries is the proof that an environment
 * variable beats the file's. That precedence is what keeps every test above independent of a developer's own `.env`;
 * running without one is the test before this.
 */
test('the command reads its credentials from .env, and the environment wins over the file', async () => {
  const map = await standIn((request, response) =>
    request.path === '/api/auth/login'
      ? json(response, 401, {
          success: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' },
        })
      : json(response, 200, {}),
  );
  const root = mkdtempSync(join(tmpdir(), 'watch-livepokemap-'));

  writeFileSync(join(root, '.env'), `LPM_BASE_URL=${map.url}\nLPM_USERNAME=the-file\nLPM_PASSWORD=the-file\n`);

  const child = run(process.execPath, [SCRIPT, fixturePath('shiny-hunt.json')], {
    cwd: root,
    env: { PATH: process.env.PATH ?? '', LPM_USERNAME: 'the-environment' },
  });
  let output = '';

  child.stderr.on('data', (chunk) => (output += chunk));

  try {
    // A refused login stops the command, so there is nothing to wait out: what it sent by then is all it will send.
    expect(await new Promise<number | null>((exited) => child.on('exit', exited))).toBe(1);
  } finally {
    child.kill('SIGKILL');
    await map.close();
    rmSync(root, { recursive: true, force: true });
  }

  expect(output).toContain('Live PokeMap refused the login');
  expect(map.requests.find((request) => request.path === '/api/auth/login')?.body).toStrictEqual({
    username: 'the-environment',
    password: 'the-file',
  });
});
