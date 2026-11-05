/**
 * The parts of the watcher that decide, each without a network: what a query wants, what a notification says, how
 * long a failure is waited out, and when a spawn is forgotten. `cli.test.mts` drives the whole of it against stand-ins.
 *
 * `fixtures/viewport.json` is built from the field names the page's own parser reads (`wd`, quoted in `wire.mts`), not
 * cut from a capture: the HAR in #189 stays out of the repository, and this is what replaces it until a scrubbed one is
 * cut. Its `despawn_ms` are 0 and are set relative to the clock by whatever reads it.
 */

import { FILTER_DEFAULTS, type FilterConfig } from '../../livepokemap/filter-format.ts';
import { Backoff } from './backoff.mts';
import { LoginRefused } from './client.mts';
import { namesOf, notificationFor, reasonsFor } from './message.mts';
import { publishUrl } from './ntfy.mts';
import { admits, blindSpots, parseQuery, shows, wants, widest, type Query } from './query.mts';
import { Seen } from './seen.mts';
import { firstAnswer, match, messageOf } from './watcher.mts';
import {
  ApiError,
  refreshInterval,
  toSpawn,
  unwrap,
  type GameData,
  type ViewportResponse,
  type WireSpawn,
} from './wire.mts';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');

const NOW = Date.UTC(2026, 9, 11, 12, 0);
const DATA = JSON.parse(fixture('game-data.json')) as GameData;
const SHINY_HUNT = parseQuery('shiny-hunt.json', fixture('shiny-hunt.json'));
const XXL_HUNT = parseQuery('xxl.json', fixture('xxl.json'));

/** The fixture with every spawn ten minutes from despawning. */
function viewport(): ViewportResponse {
  const answer = JSON.parse(fixture('viewport.json')) as ViewportResponse;
  const live = (spawn: WireSpawn) => ({ ...spawn, despawn_ms: NOW + 10 * 60_000 });

  return { ...answer, pokemon: answer.pokemon?.map(live), my_shiny_pokemon: answer.my_shiny_pokemon?.map(live) };
}

const spawn = (fields: WireSpawn) => toSpawn({ encounter_id: 'x', dex_id: 1, despawn_ms: NOW + 60_000, ...fields });

test('a query is a display filter spread over the defaults, as Live PokeMap imports one', () => {
  expect(SHINY_HUNT.config).toStrictEqual({
    ...FILTER_DEFAULTS,
    speciesFilterMode: 'allowlist',
    speciesFilterList: [1, 19],
  });

  // The importer's own test: the sentinel compared with `===`, and a config required.
  expect(() => parseQuery('a', '{"_lpm_display_filter": 1, "config": {}}')).toThrow(
    'not a Live PokeMap display filter',
  );
  expect(() => parseQuery('a', '{"_lpm_display_filter": true}')).toThrow('not a Live PokeMap display filter');
  expect(() => parseQuery('a', 'nope')).toThrow('a: not JSON');

  // A field of the wrong type is refused rather than left to make a watcher that never fires.
  expect(() => parseQuery('a', '{"_lpm_display_filter": true, "config": {"minIV": "90"}}')).toThrow('config.minIV');
  expect(() => parseQuery('a', '{"_lpm_display_filter": true, "config": {"speciesFilterList": ["1"]}}')).toThrow(
    'config.speciesFilterList',
  );
  expect(() => parseQuery('a', '{"_lpm_display_filter": true, "config": {"speciesFilterMode": "only"}}')).toThrow(
    'speciesFilterMode',
  );
});

/**
 * The page's filter, case by case. The allowlist does not hold back a 100% spawn or an XXL while their `alwaysShow`
 * switches are on, which is why a 100% spawn of any species reaches a shiny hunt's watcher, as it reaches its map.
 */
test('`shows` draws what the map draws', () => {
  const hunt = SHINY_HUNT.config;

  expect(shows(spawn({ dex_id: 147, iv_percent: 100 }), hunt)).toBe(true);
  expect(shows(spawn({ dex_id: 147, iv_percent: 100 }), { ...hunt, alwaysShowPerfect: false })).toBe(false);
  expect(shows(spawn({ dex_id: 147, iv_percent: 40, size: 5 }), hunt)).toBe(true);
  expect(shows(spawn({ dex_id: 147, iv_percent: 0 }), hunt)).toBe(true);
  expect(shows(spawn({ dex_id: 147, iv_percent: 40 }), hunt)).toBe(false);
  expect(shows(spawn({ dex_id: 1, iv_percent: 40 }), hunt)).toBe(true);

  // No IV at all is drawn only under Show All with the full IV range.
  expect(shows(spawn({ dex_id: 1 }), hunt)).toBe(false);
  expect(shows(spawn({ dex_id: 1 }), { ...FILTER_DEFAULTS, showAll: true, speciesFilterMode: 'allowlist' })).toBe(true);

  const xxl = XXL_HUNT.config;

  expect(shows(spawn({ dex_id: 129, iv_percent: 40, size: 5 }), xxl)).toBe(true);
  expect(shows(spawn({ dex_id: 129, iv_percent: 40, size: 1 }), xxl)).toBe(false);
  expect(shows(spawn({ dex_id: 130, iv_percent: 40, size: 5 }), xxl)).toBe(false);

  // IV and level bounds.
  const bounded = { ...FILTER_DEFAULTS, alwaysShowZero: false, minIV: 90, minLevel: 20, maxLevel: 30 };

  expect(shows(spawn({ iv_percent: 91, level: 25 }), bounded)).toBe(true);
  expect(shows(spawn({ iv_percent: 89, level: 25 }), bounded)).toBe(false);
  expect(shows(spawn({ iv_percent: 91, level: 31 }), bounded)).toBe(false);
  expect(shows(spawn({ iv_percent: 91, level: 19 }), bounded)).toBe(false);
});

test('a blocklist lets through what it does not name', () => {
  const blocked = { ...FILTER_DEFAULTS, speciesFilterMode: 'blocklist' as const, speciesFilterList: [19] };

  expect(admits(blocked, 19)).toBe(false);
  expect(admits(blocked, 1)).toBe(true);
  expect(admits(FILTER_DEFAULTS, 19)).toBe(true);
});

test('the shiny list is matched on the species filter, whatever `showMyShinies` says', () => {
  const bulbasaur = spawn({ dex_id: 1, iv_percent: 40, shiny: true });
  const unown = spawn({ dex_id: 201, iv_percent: 40, shiny: true });

  expect(SHINY_HUNT.config.showMyShinies).toBe(false);
  expect(wants(SHINY_HUNT, bulbasaur, 'my_shiny_pokemon', true, true)).toBe(true);
  expect(wants(SHINY_HUNT, unown, 'my_shiny_pokemon', true, true)).toBe(false);
});

test('`shinyOnly` holds back a non-shiny only where `showMyShinies` is on and shinies are ready, as on the map', () => {
  const perfect = spawn({ dex_id: 1, iv_percent: 100 });
  const only = { ...SHINY_HUNT, config: { ...SHINY_HUNT.config, shinyOnly: true } };
  const reallyOnly = { ...SHINY_HUNT, config: { ...only.config, showMyShinies: true } };

  expect(wants(only, perfect, 'pokemon', false, true)).toBe(true);
  expect(wants(reallyOnly, perfect, 'pokemon', false, true)).toBe(false);
  expect(wants(reallyOnly, perfect, 'pokemon', true, true)).toBe(true);

  // Without `shiny_ready` the filter draws as if `shinyOnly` were off, so its 100% spawns still notify.
  expect(wants(reallyOnly, perfect, 'pokemon', false, false)).toBe(true);
});

test('each spawn either list holds is matched once, with every query that wants it and every reason', () => {
  const { found } = match(viewport(), [SHINY_HUNT, XXL_HUNT], NOW);
  const by = Object.fromEntries(found.map((each) => [each.spawn.name, [each.reasons, each.by]]));

  expect(by).toStrictEqual({
    Dratini: [['100%'], ['shiny-hunt.json']],
    Magikarp: [
      ['100%', 'XXL'],
      ['shiny-hunt.json', 'xxl.json'],
    ],

    // Shiny by `my_shiny_encounters`, though its own `shiny` is unset.
    Rattata: [['Shiny', '100%'], ['shiny-hunt.json']],

    Bulbasaur: [['Shiny'], ['shiny-hunt.json']],
  });
});

test('a spawn already gone is not matched', () => {
  expect(match(viewport(), [SHINY_HUNT], NOW + 11 * 60_000)).toStrictEqual({ found: [], numberless: 0 });
});

/**
 * Each of these is a 100% spawn, which a query with no species list draws (`alwaysShowPerfect`), and a shiny, which
 * the same query admits — so every one would be wanted, and named by a number no species has, if it reached `wants`.
 */
test('a spawn without a dex number is counted rather than matched', () => {
  const everything = parseQuery('all.json', '{"_lpm_display_filter": true, "config": {}}');
  const perfect = (encounter: string, dex?: number): WireSpawn => ({
    encounter_id: encounter,
    dex_id: dex,
    iv_percent: 100,
    despawn_ms: NOW + 60_000,
  });

  const { found, numberless } = match(
    {
      pokemon: [perfect('zero', 0), perfect('negative', -1), perfect('missing'), perfect('bulbasaur', 1)],

      // One spawn in both lists is one spawn without a number, not two.
      my_shiny_pokemon: [perfect('zero', 0), perfect('shiny', -25)],
    },
    [everything],
    NOW,
  );

  expect(found.map((each) => each.spawn.encounterId)).toStrictEqual(['bulbasaur']);
  expect(numberless).toBe(4);
});

test('the filter sent is wide enough for every query', () => {
  const sent = widest([SHINY_HUNT, XXL_HUNT]);

  expect(sent.speciesFilterMode).toBe('allowlist');
  expect(sent.speciesFilterList).toStrictEqual([1, 19, 129]);
  expect(sent.alwaysShowPerfect).toBe(true);
  expect(sent.filterXXL).toBe(false);
  expect(sent.showMyShinies).toBe(true);

  // One query without a species list opens it for all.
  expect(widest([SHINY_HUNT, parseQuery('all', '{"_lpm_display_filter": true, "config": {}}')]).speciesFilterMode).toBe(
    'off',
  );

  expect(() => widest([])).toThrow('no queries');

  // Narrowing to sizes survives only where every query narrows.
  expect(widest([XXL_HUNT]).filterXXL).toBe(true);
});

/** Queries that differ on every field, so a bound from the wrong end or a flag from the wrong quantifier shows. */
test('the filter sent is the union of queries that differ on every field', () => {
  const narrow: FilterConfig = {
    showAll: false,
    minIV: 50,
    maxIV: 80,
    alwaysShowPerfect: false,
    alwaysShowZero: false,
    alwaysShowRare: false,
    alwaysShowSize: false,
    filterXXS: true,
    filterXXL: false,
    minLevel: 10,
    maxLevel: 30,
    speciesFilterMode: 'allowlist',
    speciesFilterList: [3],
    showPvpGreatLeague: true,
    showPvpUltraLeague: false,
    showPvpLittleLeague: false,
    pvpMaxRank: 5,
    showMyShinies: true,
    shinyOnly: true,
  };

  const other: FilterConfig = {
    showAll: true,
    minIV: 20,
    maxIV: 90,
    alwaysShowPerfect: true,
    alwaysShowZero: true,
    alwaysShowRare: true,
    alwaysShowSize: true,
    filterXXS: false,
    filterXXL: true,
    minLevel: 5,
    maxLevel: 40,
    speciesFilterMode: 'allowlist',
    speciesFilterList: [1],
    showPvpGreatLeague: false,
    showPvpUltraLeague: true,
    showPvpLittleLeague: true,
    pvpMaxRank: 25,
    showMyShinies: false,
    shinyOnly: false,
  };

  const queries = [narrow, other].map((config, index) => ({ name: `${index}.json`, config }));

  const union: FilterConfig = {
    showAll: true,
    minIV: 20,
    maxIV: 90,
    alwaysShowPerfect: true,
    alwaysShowZero: true,
    alwaysShowRare: true,
    alwaysShowSize: true,
    filterXXS: true,
    filterXXL: true,
    minLevel: 5,
    maxLevel: 40,
    speciesFilterMode: 'allowlist',
    speciesFilterList: [1, 3],
    showPvpGreatLeague: true,
    showPvpUltraLeague: true,
    showPvpLittleLeague: true,
    pvpMaxRank: 25,
    showMyShinies: true,
    shinyOnly: false,
  };

  expect(widest(queries)).toStrictEqual(union);
  expect(widest([...queries].reverse())).toStrictEqual(union);

  // Narrowing to sizes is dropped by a query that does not narrow to any, and shiny-only by one that is not.
  const open = { name: 'open.json', config: FILTER_DEFAULTS };

  expect(widest([...queries, open])).toMatchObject({ filterXXS: false, filterXXL: false, shinyOnly: false });
  expect(widest([queries[0] as Query])).toMatchObject({ filterXXS: true, filterXXL: false, shinyOnly: true });
});

test('what a query cannot see from the world is said, and nothing is said of one that can see it all', () => {
  expect(blindSpots(SHINY_HUNT.config)).toStrictEqual([
    'spawns from 0% to 99% IV',
    '0% spawns',
    'XXL and XXS spawns below 100%',
    'rare species',
  ]);
  expect(blindSpots(XXL_HUNT.config)).toStrictEqual(['XXL spawns from 0% to 99% IV']);
  expect(
    blindSpots({ ...FILTER_DEFAULTS, minIV: 100, alwaysShowZero: false, alwaysShowSize: false, alwaysShowRare: false }),
  ).toStrictEqual([]);
  expect(blindSpots({ ...FILTER_DEFAULTS, shinyOnly: true, showMyShinies: true })).toStrictEqual([]);
});

test('the IV band said is the one the query asked for', () => {
  const band = { ...FILTER_DEFAULTS, alwaysShowZero: false, alwaysShowSize: false, alwaysShowRare: false };

  expect(blindSpots({ ...band, maxIV: 50 })).toStrictEqual(['spawns from 0% to 50% IV']);
  expect(blindSpots({ ...band, showAll: true })).toStrictEqual(['every spawn ("Show All")']);

  // Show All within a narrower band draws only that band.
  expect(blindSpots({ ...band, showAll: true, maxIV: 50 })).toStrictEqual(['spawns from 0% to 50% IV']);
  expect(blindSpots({ ...band, showAll: true, minIV: 50 })).toStrictEqual(['spawns from 50% to 99% IV']);
});

test('the first poll says whether the account has shiny access', () => {
  expect(firstAnswer(viewport())).toBe('First poll: 3 spawns and 2 shinies, with shiny access');
  expect(firstAnswer({ pokemon: [], shiny_access: false })).toMatch(/no shiny access .*Premium/);
});

test('a notification names the species, form, reason, IV, CP, level, place and time left', () => {
  const rattata = toSpawn({ ...viewport().pokemon?.find((each) => each.dex_id === 19), shiny: true });

  expect(notificationFor(rattata, reasonsFor(rattata, true), DATA, NOW, 'UTC')).toStrictEqual({
    title: 'Shiny 100% Rattata (Alola)',
    message: 'IV 15/15/15 (100%) · CP 402 · L31\nDespawns 12:10 (10 min left)\n51.500729,-0.124625',
    tags: ['sparkles', '100'],
    click: 'https://www.google.com/maps/search/?api=1&query=51.500729,-0.124625',
    priority: 5,
  });
});

test('a notification for a spawn with no despawn time says so rather than giving minutes left', () => {
  const larvitar = spawn({ dex_id: 246, iv_percent: 100, lat: 1.283, lon: 103.86, despawn_ms: undefined });

  expect(notificationFor(larvitar, reasonsFor(larvitar, false), DATA, NOW, 'UTC').message).toBe(
    'IV 100%\nDespawn time unknown\n1.283000,103.860000',
  );
});

test('the ordinary form is left unnamed', () => {
  expect(namesOf(spawn({ dex_id: 19, form: 45 }), DATA)).toStrictEqual({ species: 'Rattata', form: null });
  expect(namesOf(spawn({ dex_id: 19, form: 0 }), DATA)).toStrictEqual({ species: 'Rattata', form: null });
  expect(namesOf(spawn({ dex_id: 999, pokemon_name: 'Gimmighoul' }), DATA)).toStrictEqual({
    species: 'Gimmighoul',
    form: null,
  });
});

test("the poll interval is the server's, never under five seconds", () => {
  expect(refreshInterval(JSON.parse(fixture('config.json')))).toBe(15_000);
  expect(refreshInterval({})).toBe(15_000);
  expect(refreshInterval({ viewport_refresh_seconds: 1 })).toBe(5_000);
});

test('a failure is unwrapped from the envelope with its status', () => {
  expect(unwrap({ success: true, data: { token: 't' } }, 200, true)).toStrictEqual({ token: 't' });
  expect(unwrap({ viewport_refresh_seconds: 15 }, 200, true)).toStrictEqual({ viewport_refresh_seconds: 15 });

  const refused = () =>
    unwrap({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401, false);

  expect(refused).toThrow(ApiError);
  expect(refused).toThrow('Authentication required');
  expect(() => unwrap(null, 503, false)).toThrow('Request failed: 503');
});

test('backoff doubles to its ceiling, and starts over on a success', () => {
  const backoff = new Backoff(15_000, 120_000, () => 0.5);

  expect([backoff.failed(), backoff.failed(), backoff.failed(), backoff.failed()]).toStrictEqual([
    30_000, 60_000, 120_000, 120_000,
  ]);

  backoff.succeeded();
  expect(backoff.failed()).toBe(30_000);

  // Never past the ceiling, jitter and all.
  const capped = new Backoff(15_000, 120_000, () => 1);

  expect([capped.failed(), capped.failed(), capped.failed(), capped.failed()]).toStrictEqual([
    37_500, 75_000, 120_000, 120_000,
  ]);

  // Jitter stays within a quarter either way.
  expect(new Backoff(15_000, 120_000, () => 0).failed()).toBe(22_500);
  expect(new Backoff(15_000, 120_000, () => 1).failed()).toBe(37_500);
});

test('a spawn is remembered until its despawn and forgotten after', () => {
  const seen = new Seen();

  expect(seen.has('a', NOW)).toBe(false);
  seen.remember('a', NOW + 60_000);
  expect(seen.has('a', NOW + 59_999)).toBe(true);
  expect(seen.has('a', NOW + 60_000)).toBe(false);
  expect(seen.size).toBe(0);
});

/**
 * The shapes below are undici's own, measured rather than assumed: a connect failure is a `TypeError` over an
 * `AggregateError` whose own message is empty and whose entries are one per address tried. A reporter reading
 * `message` alone printed `fetch failed` for every failure below HTTP and named none of them.
 */
test('a failure is reported with its cause rather than as a bare wrapper', () => {
  const connect = new TypeError('fetch failed', {
    cause: new AggregateError([
      new Error('connect ETIMEDOUT 159.203.148.75:443'),
      new Error('connect ECONNREFUSED :::443'),
    ]),
  });

  expect(messageOf(connect)).toBe('fetch failed: connect ETIMEDOUT 159.203.148.75:443, connect ECONNREFUSED :::443');

  // A DNS failure hangs one ordinary error off `cause`, which says enough on its own.
  expect(messageOf(new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND ntfy.sh') }))).toBe(
    'fetch failed: getaddrinfo ENOTFOUND ntfy.sh',
  );

  // A cause the message above it already quotes is not said twice, which is how `LoginRefused` composes its own.
  expect(messageOf(new LoginRefused(new ApiError('Invalid username or password', 401, 'INVALID_CREDENTIALS')))).toBe(
    'Live PokeMap refused the login: Invalid username or password',
  );

  // A cause the message above it merely reads as a fragment of is its own reason, not a repeat of one.
  expect(messageOf(new Error('Request failed: 503 reading /api/config', { cause: new Error('503') }))).toBe(
    'Request failed: 503 reading /api/config: 503',
  );

  // `cause` is writable, so a cycle is reachable, and a walk that circled one would hang an overnight run silently.
  const circular = new Error('outer');

  circular.cause = new Error('inner', { cause: circular });

  expect(messageOf(circular)).toBe('outer: inner');

  expect(messageOf(new ApiError('Try later', 429, 'RATE_LIMITED'))).toBe('Try later');
  expect(messageOf('not an error at all')).toBe('not an error at all');
});

test("a publish goes to the ntfy server's own root, a subpath and all", () => {
  expect(String(publishUrl('https://ntfy.sh'))).toBe('https://ntfy.sh/');
  expect(String(publishUrl('https://ntfy.sh/'))).toBe('https://ntfy.sh/');
  expect(String(publishUrl('https://example.com/ntfy'))).toBe('https://example.com/ntfy/');
  expect(String(publishUrl('https://example.com/ntfy/'))).toBe('https://example.com/ntfy/');
});
