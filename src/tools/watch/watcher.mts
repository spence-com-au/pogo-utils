/**
 * The loop: read what the page reads on load, log in, then one viewport request per refresh interval for as long as it
 * is let run, notifying each spawn a query wants once.
 *
 * One request per interval whatever the number of queries, carrying `widest` of them, because that is what one open
 * tab sends; every query is then matched against the answer here. A failure waits out `Backoff` instead of the
 * interval, and the loop carries on — a watcher meant to run overnight cannot stop at the first 502.
 *
 * The clock and the wait are parameters so that a test can drive the loop without waiting on either.
 */

import { Backoff } from './backoff.mts';
import { LoginRefused, type LivePokeMap } from './client.mts';
import { notificationFor, reasonsFor, type Reason } from './message.mts';
import { publish, type Notification, type Ntfy } from './ntfy.mts';
import { wants, widest, type List, type Query } from './query.mts';
import { Seen } from './seen.mts';
import {
  refreshInterval,
  toSpawn,
  wireFilter,
  WORLD,
  type GameData,
  type Spawn,
  type ViewportResponse,
} from './wire.mts';
import { setTimeout as delay } from 'node:timers/promises';

/** The longest a failure is waited out: long enough to stop hammering, short enough to be back within the hour. */
const BACKOFF_CEILING = 15 * 60_000;

/** How long a spawn with no despawn time is remembered, which is longer than any spawn lasts. */
const UNKNOWN_DESPAWN = 60 * 60_000;

/**
 * How many polls a notification is tried on before its spawn is remembered unsent: enough to ride out a 429 or a blip,
 * few enough that a topic the server refuses outright is not asked about for as long as the spawn lives.
 */
export const NOTIFY_ATTEMPTS = 3;

export interface WatchOptions {
  client: LivePokeMap;
  queries: readonly Query[];
  signal: AbortSignal;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;

  /**
   * Where to send each match. Without it the watcher runs console only: a match is printed in full, through `log`, and
   * remembered as notified all the same, so it is printed once rather than on every poll that carries it.
   */
  ntfy?: Ntfy;

  /** Every line worth saying. `debug` is for what only `--verbose` asks to hear. */
  log: (line: string) => void;
  debug?: (line: string) => void;
}

const sleepFor = async (ms: number, signal: AbortSignal) => {
  try {
    await delay(ms, undefined, { signal });
  } catch {
    // Aborted, which the loop checks for itself.
  }
};

export async function watch(options: WatchOptions): Promise<void> {
  const { client, ntfy, queries, signal, log } = options;
  const debug = options.debug ?? (() => {});
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? sleepFor;

  const [interval, data] = await startup(options);
  const backoff = new Backoff(interval, BACKOFF_CEILING, options.random);
  const seen = new Seen();
  const attempts = new Map<string, number>();
  const body = { ...WORLD, display_filters: wireFilter(widest(queries)) };
  let tier: string | undefined;
  let numberless = 0;
  let first = true;

  log(
    `Watching the world every ${interval / 1000}s for ${queries.length} ${queries.length === 1 ? 'query' : 'queries'}` +
      (ntfy ? '' : ', console only (NTFY_TOPIC is not set)'),
  );

  while (!signal.aborted) {
    let wait = interval;

    try {
      const answer = await client.viewport(body, signal);

      // Said on the first answer whatever it carries: `tier` starts as the same `undefined` an answer without the field
      // reads as, and this line is the only check there is that `WORLD` is wide enough.
      if (first || answer.span_tier !== tier) {
        tier = answer.span_tier;

        if (tier !== 'perfect') {
          log(
            `The server answered ${tier === undefined ? 'no span tier' : `span tier ${JSON.stringify(tier)}`}, ` +
              'where the world view expects "perfect"',
          );
        }
      }

      if (first) {
        first = false;
        log(firstAnswer(answer));
      }

      const { found, numberless: unread } = match(answer, queries, now());

      // Said when it starts rather than on every poll it lasts, as the span tier is.
      if (unread > 0 && numberless === 0) {
        log(
          `The server answered ${unread} ${unread === 1 ? 'spawn' : 'spawns'} without a dex number, ` +
            'which no query can want',
        );
      }

      numberless = unread;

      debug(
        `${answer.pokemon?.length ?? 0} spawns, ` +
          `${answer.my_shiny_pokemon?.length ?? 0} shinies, ${found.length} wanted`,
      );

      const unsent: (Match & { notification: Notification })[] = [];

      for (const { spawn, reasons, by } of found) {
        if (seen.has(spawn.encounterId, now())) {
          continue;
        }

        const notification = notificationFor(spawn, reasons, data, now());

        if (!ntfy) {
          seen.remember(spawn.encounterId, spawn.despawnMs ?? now() + UNKNOWN_DESPAWN);
          log(`Found ${notification.title} (${by.join(', ')})`);

          for (const line of [...notification.message.split('\n'), notification.click ?? '']) {
            if (line) {
              log(`  ${line}`);
            }
          }

          continue;
        }

        unsent.push({ spawn, reasons, by, notification });
      }

      // A spawn that despawned before its notification went or was given up on is not asked about again.
      for (const id of attempts.keys()) {
        if (!unsent.some(({ spawn }) => spawn.encounterId === id)) {
          attempts.delete(id);
        }
      }

      // Sent together rather than one after another, so a poll waits on one publish's timeout however many are unsent.
      const results = ntfy
        ? await Promise.allSettled(unsent.map(({ notification }) => publish(ntfy, notification, signal)))
        : [];

      if (signal.aborted) {
        break;
      }

      // A poll succeeds only once every notification it owed has gone, so an ntfy refusing them is backed off from as a
      // refused viewport is, rather than asked again at the poll rate.
      if (results.some((result) => result.status === 'rejected')) {
        wait = backoff.failed();
      } else {
        backoff.succeeded();
      }

      for (const [index, { spawn, by, notification }] of unsent.entries()) {
        const result = results[index];
        const id = spawn.encounterId;

        if (result?.status === 'rejected') {
          const tried = (attempts.get(id) ?? 0) + 1;
          const why = `Could not notify ${notification.title}: ${messageOf(result.reason)}`;

          if (tried < NOTIFY_ATTEMPTS) {
            attempts.set(id, tried);
            log(`${why}; trying again in ${Math.round(wait / 1000)}s`);
            continue;
          }

          log(`${why}; giving up after ${tried} attempts`);
        } else {
          log(`Notified ${notification.title} at ${spawn.lat},${spawn.lon} (${by.join(', ')})`);
        }

        attempts.delete(id);
        seen.remember(id, spawn.despawnMs ?? now() + UNKNOWN_DESPAWN);
      }
    } catch (error) {
      if (signal.aborted) {
        break;
      }

      // A re-login refused hours in stops the watcher as one refused at start does, rather than retrying it.
      if (error instanceof LoginRefused) {
        throw error;
      }

      wait = backoff.failed();
      log(`${messageOf(error)}; trying again in ${Math.round(wait / 1000)}s`);
    }

    await sleep(wait, signal);
  }
}

/**
 * What the page does before its first viewport, each step retried after a wait until it answers. A login the server
 * refuses outright is the one thing that is not retried: a wrong password asked again every few minutes is a locked
 * account, and nobody is there to notice it.
 */
async function startup(options: WatchOptions): Promise<[number, GameData]> {
  const { client, signal, log } = options;
  const sleep = options.sleep ?? sleepFor;
  const backoff = new Backoff(15_000, BACKOFF_CEILING, options.random);

  const attempt = async <T,>(what: string, step: () => Promise<T>): Promise<T> => {
    for (;;) {
      try {
        const answer = await step();

        backoff.succeeded();

        return answer;
      } catch (error) {
        if (signal.aborted) {
          throw error;
        }

        if (error instanceof LoginRefused) {
          throw error;
        }

        const wait = backoff.failed();

        log(`Could not ${what}: ${messageOf(error)}; trying again in ${Math.round(wait / 1000)}s`);
        await sleep(wait, signal);
      }
    }
  };

  const config = await attempt('read /api/config', () => client.config(signal));
  const data = await attempt('read /api/game_data', () => client.gameData(signal));

  await attempt('log in', () => client.login(signal));
  log('Logged in to Live PokeMap');
  await attempt('load the map', () => client.startup(signal));

  return [refreshInterval(config), data];
}

/**
 * A failure as one line, cause and all. `fetch` says only `fetch failed` for everything that goes wrong below HTTP and
 * hangs the real reason off `cause` — where a connect failure puts an `AggregateError` whose own message is empty and
 * whose `errors` hold one entry per address tried, so `message` alone names nothing anyone can act on.
 *
 * Dropped as a repeat only where the message above quotes a cause whole, as `LoginRefused` quotes its own; one that
 * merely reads as a fragment of an earlier message is its own reason and is kept. `cause` is writable, so the walk
 * stops at a link it has already seen rather than circling forever in a watcher nobody is watching.
 */
export function messageOf(error: unknown): string {
  const said: string[] = [];
  const walked = new Set<unknown>();

  for (let link: unknown = error; link instanceof Error && !walked.has(link); link = link.cause) {
    walked.add(link);

    const text =
      link instanceof AggregateError
        ? [...new Set(link.errors.filter((inner) => inner instanceof Error).map((inner) => inner.message))].join(', ')
        : link.message;

    if (text && !said.some((earlier) => earlier === text || earlier.endsWith(`: ${text}`))) {
      said.push(text);
    }
  }

  return said.join(': ') || String(error);
}

/**
 * What the account turned out to be able to see, said once. Which lists come back is a matter of its plan rather than
 * of anything sent: Live PokeMap's own pricing gives Pokémon with IVs from Explorer up and "your own shinies" at
 * Premium, and the viewport says which of the second this account has as `shiny_access`. Said rather than assumed, so a
 * query waiting on shinies an account cannot be shown is pointed out on the first poll rather than left to wait.
 */
export function firstAnswer(answer: ViewportResponse): string {
  const counts = `${answer.pokemon?.length ?? 0} spawns and ${answer.my_shiny_pokemon?.length ?? 0} shinies`;

  if (answer.shiny_access === false) {
    return (
      `First poll: ${counts}. ` +
      'This account has no shiny access (Live PokeMap Premium), so no shiny will be notified'
    );
  }

  return `First poll: ${counts}${answer.shiny_access ? ', with shiny access' : ''}`;
}

interface Match {
  spawn: Spawn;
  reasons: Reason[];

  /** The queries that want it, by name. */
  by: string[];
}

interface Matches {
  found: Match[];

  /**
   * How many spawns came without a dex number, which `toSpawn` reads as 0. No species filter can look one up, so none
   * is matched — but every spawn arriving that way is the feed changing shape rather than nothing to find, so they are
   * counted for the watcher to say so instead of falling quiet.
   */
  numberless: number;
}

/** Every spawn in either list that a query wants and that has not despawned, once each however many lists hold it. */
export function match(answer: ViewportResponse, queries: readonly Query[], now: number): Matches {
  const wild = (answer.pokemon ?? []).map(toSpawn);
  const mine = (answer.my_shiny_pokemon ?? []).map(toSpawn);
  const lists: [List, Spawn[]][] = [
    ['pokemon', wild],
    ['my_shiny_pokemon', mine],
  ];
  const shinies = new Set([
    ...(answer.my_shiny_encounters ?? []).map(String),
    ...mine.map((spawn) => spawn.encounterId),
  ]);
  const shinyReady = answer.shiny_ready === true;
  const found = new Map<string, Match>();
  const numberless = new Set<string>();

  for (const [list, spawns] of lists) {
    for (const spawn of spawns) {
      if (spawn.encounterId === '' || (spawn.despawnMs !== null && spawn.despawnMs <= now)) {
        continue;
      }

      if (spawn.dexId <= 0) {
        numberless.add(spawn.encounterId);
        continue;
      }

      const shiny = spawn.shiny || shinies.has(spawn.encounterId);
      const by = queries.filter((query) => wants(query, spawn, list, shiny, shinyReady)).map((query) => query.name);

      if (by.length === 0) {
        continue;
      }

      const known = found.get(spawn.encounterId);

      if (known) {
        known.by = [...new Set([...known.by, ...by])];
      } else {
        found.set(spawn.encounterId, { spawn, reasons: reasonsFor(spawn, shiny), by });
      }
    }
  }

  return { found: [...found.values()], numberless: numberless.size };
}
