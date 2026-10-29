/**
 * The whole loop against a scripted phone: recorded frames of each screen, moved on by a tap in the right place and by
 * nothing else, under a clock that only advances when the run waits or the phone works, on which a screenshot or an OCR
 * read takes as long as it would on a real phone. A tap anywhere a screen does not answer leaves it where it is, which
 * is how a wrong tap shows: the run stalls, and ends `Lost`.
 */

import { type GameData } from '../inventory/game-master.mts';
import { decodePng, type Image } from '../inventory/png.mts';
import { useEngine, type Engine } from '../inventory/ocr.mts';
import { tesseractCli } from '../inventory/ocr-cli.mts';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setImmediate } from 'node:timers/promises';
import { expect, test } from 'vitest';
import { silhouetteOfIcon } from './party.mts';
import { BENCH, BENCH_ANCHOR, type Point } from './play.mts';
import { bubbleSwipes, typeColour } from './minigame.mts';
import { place } from './layout.mts';
import { type Fight, type Reporter } from './report.mts';
import { Lost, LOST_MS, run, type Clock, type Phone } from './run.mts';

/** How long Tesseract takes over a band of a battle's frame, in milliseconds: `readBattle` reads two, about 220ms. */
const OCR_MS = 110;

/**
 * Tesseract's answer to each read, by the band and how it was asked, kept across the file's tests: the scripted battles
 * read the same few fixture frames over and over, 1316 reads of 74 distinct bands, and the CLI answers a band the same
 * way every time, so asking it again would spend some 350 of the file's 430 seconds on answers already had. A
 * remembered read still takes `ocrMs` on the scripted clock, which is the only time a run sees.
 */
const READS = new Map<string, Promise<string>>();

const tsv: Engine['tsv'] = (image, psm, whitelist) => {
  const key = `${createHash('sha1').update(image.data).digest('hex')} ${image.width} ${psm} ${whitelist}`;
  let read = READS.get(key);

  if (!read) {
    read = tesseractCli.tsv(image, psm, whitelist);
    READS.set(key, read);
  }

  return read;
};

const DATA = JSON.parse(
  readFileSync(new URL('../inventory/fixtures/game-master.json', import.meta.url), 'utf8'),
) as GameData;

const fixture = (name: string) =>
  decodePng(readFileSync(fileURLToPath(new URL(`fixtures/${name}.png`, import.meta.url))));

/** A reporter keeping what a run tells it: each event after the side it is of, and the battle as each status had it. */
function recorder(): Reporter & { events: string[]; fights: Fight[] } {
  const events: string[] = [];
  const fights: Fight[] = [];

  return {
    events,
    fights,
    event: (line, side, why) => events.push(`${side ?? 'run'}: ${line}${why ? `: ${why}` : ''}`),
    status: ({ fight }) => fight && fights.push(fight),
  };
}

/** The icons `party.test.mts` reads the party screens against. */
const ICONS = readdirSync(new URL('fixtures/icons/', import.meta.url)).map((icon) => ({
  species: DATA.forms.find((form) => form.icon === icon)?.species ?? icon,
  silhouette: silhouetteOfIcon(fixture(`icons/${icon.replace(/[.]png$/, '')}`)),
}));

/** The game's icon for each type, by the game master's type names. */
const TYPE_ICONS = Object.fromEntries(
  DATA.types.map((type) => [type, fixture(`types/POKEMON_TYPE_${type.toUpperCase()}`)]),
);

interface Scene {
  frame: Image;
  screenshot?: Image;

  /** Where a tap moves the phone on from here, and to which scene. */
  tap?: { at: Point; to: string };

  /** How many swipes move the phone on from here, and to which scene. */
  swipes?: { count: number; to: string };

  /** How long the scene lasts on its own before moving on, in milliseconds. */
  lasts?: { ms: number; to: string };
}

/**
 * A phone playing `scenes` from `start`, and the clock it runs on. Each OCR read takes `ocrMs` of it, given the time the
 * read began: `OCR_MS` unless a test slows it.
 */
function scripted(
  scenes: Record<string, Scene>,
  start: string,
  ocrMs: (at: number) => number = () => OCR_MS,
): { phone: Phone; clock: Clock; taps: string[]; strokes: { scene: string; from: Point; to: Point; at: number }[] } {
  let time = 0;
  let current = start;
  let entered = 0;
  let swiped = 0;
  const taps: string[] = [];
  const strokes: { scene: string; from: Point; to: Point; at: number }[] = [];

  // Screenshots taken and OCR begun, not yet handed back: each takes time on the run's clock, a screenshot a second and
  // a read `ocrMs`, which passes as the run waits or the phone works rather than holding the run up, as on a real
  // phone while the stream goes on. A read is handed back once that time has passed, the clock waiting there for the
  // real one to finish.
  const developing: { due: number; deliver: () => unknown }[] = [];

  // How many times the clock has moved, and whether it is moving now. A run at work comes back to the phone or the clock
  // before anything else has a turn, so one that has not by then has finished with reads still under way, which the
  // clock moves on through so that they are not left pending. `run` never awaits a read itself, but one that did would
  // be waiting on it here, and would see the read take its time, as on a real phone, rather than hang.
  let moves = 0;
  let advancing = false;

  async function advance(ms: number) {
    moves++;
    advancing = true;
    time += ms;

    for (const work of developing.filter(({ due }) => due <= time).sort((a, b) => a.due - b.due)) {
      developing.splice(developing.indexOf(work), 1);
      await work.deliver();
    }

    // Whatever follows on from what was handed back has run before the run looks at the phone again.
    await setImmediate();
    advancing = false;
    idle();
  }

  function idle() {
    const at = moves;

    void setImmediate().then(() => {
      const next = Math.min(...developing.map(({ due }) => due));

      if (moves === at && !advancing && next < Infinity) {
        void advance(next - time);
      }
    });
  }

  useEngine({
    tsv: (...args) => {
      const read = tsv(...args);
      const due = time + ocrMs(time);

      // Failing before it is due, a read fails where it is handed back rather than as a rejection nothing handles.
      read.catch(() => {});

      return new Promise((resolve, reject) => {
        developing.push({ due, deliver: () => read.then(resolve, reject) });
        idle();
      });
    },
  });

  const go = (to: string) => {
    current = to;
    entered = time;
    swiped = 0;
  };

  const scene = () => {
    const now = scenes[current];

    if (!now) {
      throw new Error(`no scene ${current}`);
    }

    if (now.lasts && time - entered >= now.lasts.ms) {
      go(now.lasts.to);
      return scene();
    }

    return now;
  };

  const phone: Phone = {
    frame: () => scene().frame,
    screenshot: () => {
      const { frame, screenshot } = scene();

      return new Promise((resolve) =>
        developing.push({ due: time + 1000, deliver: () => resolve(screenshot ?? frame) }),
      );
    },
    tap: async ([x, y]) => {
      await advance(30);
      const { tap } = scene();
      taps.push(current);

      if (tap && Math.abs(tap.at[0] - x) < 0.05 && Math.abs(tap.at[1] - y) < 0.04) {
        go(tap.to);
      }
    },
    swipe: async (from, to, ms) => {
      strokes.push({ scene: current, from, to, at: time });
      await advance(ms + 30);
      const { swipes } = scene();

      if (swipes && ++swiped >= swipes.count) {
        go(swipes.to);
      }
    },
  };

  const clock: Clock = { now: () => time, sleep: advance };

  return { phone, clock, taps, strokes };
}

/** One battle and the way back round to the next, as recorded against Blanche in the Ultra League. */
function battleAndBack(): Record<string, Scene> {
  const menu = (name: string, tap: Scene['tap'], lasts?: Scene['lasts']): Scene => ({
    frame: fixture(name),
    ...(tap && { tap }),
    ...(lasts && { lasts }),
  });

  return {
    training: menu('menu-training', { at: [0.26, 0.8], to: 'intro' }),
    intro: menu('menu-intro', { at: [0.5, 0.733], to: 'league' }),
    league: menu('menu-league', { at: [0.55, 0.58], to: 'party' }),
    party: menu('menu-party', { at: [0.5, 0.87], to: 'loading' }),
    loading: { frame: fixture('other-vs-fade'), lasts: { ms: 4000, to: 'fight' } },
    fight: { frame: fixture('battle-deoxys'), swipes: { count: 30, to: 'charged' } },
    charged: { frame: fixture('charged-shadow-sneak'), tap: { at: [0.499, 0.889], to: 'minigame' } },
    minigame: { frame: fixture('battle-minigame-giratina'), swipes: { count: 40, to: 'won' } },
    won: { frame: fixture('other-win'), screenshot: fixture('menu-unknown-medal'), lasts: { ms: 8000, to: 'result' } },
    result: menu('menu-result', { at: [0.5, 0.935], to: 'training' }),
  };
}

test('plays a battle from the Battle tab and taps its way back round', async () => {
  const { phone, clock, taps } = scripted(battleAndBack(), 'training');

  const battles = await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons: ICONS,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
  );

  expect(battles).toEqual({ battles: 1, won: 1, lost: 0 });
  expect(taps).toEqual(['training', 'intro', 'league', 'party', 'charged', 'result']);
});

/** The map's Poké Ball, BATTLE on the main menu, and the Battle tab scrolled from GO Battle League to Training. */
test('finds its way to the leader from the map', async () => {
  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      map: { frame: fixture('menu-map'), tap: { at: [0.5, 0.932], to: 'main' } },
      main: { frame: fixture('menu-main'), tap: { at: [0.777, 0.5975], to: 'tab' } },
      tab: { frame: fixture('menu-battle-league'), swipes: { count: 1, to: 'training' } },
    },
    'map',
  );

  expect(
    await run(
      phone,
      {
        mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
        data: DATA,
        icons: ICONS,
        typeIcons: TYPE_ICONS,
        count: 1,
      },
      clock,
    ),
  ).toEqual({ battles: 1, won: 1, lost: 0 });
  expect(taps.slice(0, 3)).toEqual(['map', 'main', 'training']);
});

/**
 * GO Battle League from the map: its card's BATTLE at the top of the Battle tab, the welcome before a set, the league,
 * the recommended party, and an opponent found for longer than `LOST_MS`, then NEXT BATTLE on the result, back to the
 * league.
 */
function league(): Record<string, Scene> {
  return {
    ...battleAndBack(),
    map: { frame: fixture('menu-map'), tap: { at: [0.5, 0.932], to: 'main' } },
    main: { frame: fixture('menu-main'), tap: { at: [0.777, 0.5975], to: 'tab' } },
    tab: { frame: fixture('menu-gbl-battle-tab'), tap: { at: [0.3, 0.843], to: 'welcome' } },
    welcome: { frame: fixture('menu-gbl-welcome'), tap: { at: [0.3, 0.895], to: 'league' } },
    league: { frame: fixture('menu-gbl-league'), tap: { at: [0.54, 0.43], to: 'party' } },
    party: { frame: fixture('menu-gbl-party'), tap: { at: [0.5, 0.87], to: 'matching' } },
    matching: { frame: fixture('menu-gbl-matchmaking'), lasts: { ms: LOST_MS * 2, to: 'fight' } },
    result: { frame: fixture('menu-gbl-result'), tap: { at: [0.5, 0.854], to: 'league' } },
  };
}

const GBL = { mode: 'gbl', league: 'ultra' } as const;

/**
 * Ultra League's carousel on a Pixel 8 Pro, opening on Test 4 with Test 3 and GBL after it: the party named is swiped
 * to, and only then used, and one not saved stops the run rather than battle with another.
 */
function parties(): Record<string, Scene> {
  return {
    ...league(),
    party: { frame: fixture('menu-pixel8-party-test4'), swipes: { count: 1, to: 'test3' } },
    test3: { frame: fixture('menu-pixel8-party-test3'), swipes: { count: 1, to: 'gbl' } },
    gbl: { frame: fixture('menu-pixel8-party-gbl'), tap: { at: [0.5, 0.87], to: 'matching' } },
  };
}

test('swipes the party carousel to the party named before using it', async () => {
  const { phone, clock, taps, strokes } = scripted(parties(), 'party');

  expect(
    await run(
      phone,
      { mode: { ...GBL, party: 'GBL' }, data: DATA, icons: ICONS, typeIcons: TYPE_ICONS, count: 1 },
      clock,
    ),
  ).toEqual({ battles: 1, won: 0, lost: 1 });
  expect(strokes.filter(({ scene }) => scene === 'party' || scene === 'test3')).toHaveLength(2);
  expect(taps.slice(0, 1)).toEqual(['gbl']);
});

// Eight swipes before the party, some 25s of swipes, settles and reads: longer than `LOST_MS`, and not lost for it.
test('searches a carousel for longer than the run takes to give up as lost', async () => {
  const cards = ['menu-pixel8-party-test4', 'menu-pixel8-party-test3'];
  const walk = Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [
      `card${i}`,
      { frame: fixture(cards[i % 2] ?? ''), swipes: { count: 1, to: i === 7 ? 'gbl' : `card${i + 1}` } },
    ]),
  );
  const { phone, clock, taps } = scripted({ ...parties(), ...walk }, 'card0');

  expect(
    await run(
      phone,
      { mode: { ...GBL, party: 'GBL' }, data: DATA, icons: ICONS, typeIcons: TYPE_ICONS, count: 1 },
      clock,
    ),
  ).toEqual({ battles: 1, won: 0, lost: 1 });
  expect(taps[0]).toBe('gbl');
  expect(clock.now()).toBeGreaterThan(LOST_MS);
});

test('stops rather than battle where no party has the name', async () => {
  const { phone, clock, taps } = scripted(parties(), 'party');

  await expect(
    run(phone, { mode: { ...GBL, party: 'Great' }, data: DATA, icons: ICONS, typeIcons: TYPE_ICONS, count: 1 }, clock),
  ).rejects.toThrow('no party named Great saved for this league: test 4, test 3, gbl');
  expect(taps).toEqual([]);
});

test('plays GO Battle League battles from the map, waiting out matchmaking', async () => {
  const { phone, clock, taps } = scripted(league(), 'map');

  expect(await run(phone, { mode: GBL, data: DATA, icons: ICONS, typeIcons: TYPE_ICONS, count: 2 }, clock)).toEqual({
    battles: 2,
    won: 0,
    lost: 2,
  });
  expect(taps).toEqual([
    ...['map', 'main', 'tab', 'welcome', 'league', 'party', 'charged', 'result'],
    ...['league', 'party', 'charged', 'result'],
  ]);
});

// The reward encounter's Poké Ball is left alone: GO Battle League does not come back to the map of itself.
test('taps no Poké Ball once a GO Battle League battle has been played', async () => {
  const { phone, clock, taps } = scripted(
    { ...league(), result: { frame: fixture('menu-gbl-result'), tap: { at: [0.5, 0.854], to: 'map' } } },
    'tab',
  );

  await expect(
    run(phone, { mode: GBL, data: DATA, icons: ICONS, typeIcons: TYPE_ICONS, count: 2 }, clock),
  ).rejects.toBeInstanceOf(Lost);
  expect(taps.filter((scene) => scene === 'map')).toEqual([]);
});

test('stops at the end of a GO Battle League set, leaving its reward to be collected', async () => {
  const { phone, clock, taps } = scripted(
    {
      ...league(),
      result: { frame: fixture('menu-gbl-result-last'), tap: { at: [0.5, 0.935], to: 'collect' } },
      collect: { frame: fixture('menu-gbl-collect') },
    },
    'party',
  );

  expect(await run(phone, { mode: GBL, data: DATA, icons: ICONS, typeIcons: TYPE_ICONS, count: 3 }, clock)).toEqual({
    battles: 1,
    won: 1,
    lost: 0,
  });
  expect(taps).toEqual(['party', 'charged', 'result']);
});

// The Battle tab sliding in, its BATTLE caught not yet green by the first read: the second finds it lit, and plays.
test('plays on where GO Battle League shows BATTLE greyed for one read only', async () => {
  const { phone, clock, taps } = scripted(
    { ...league(), opening: { frame: fixture('menu-gbl-collect'), lasts: { ms: 3000, to: 'tab' } } },
    'opening',
  );

  expect(await run(phone, { mode: GBL, data: DATA, icons: ICONS, typeIcons: TYPE_ICONS, count: 1 }, clock)).toEqual({
    battles: 1,
    won: 0,
    lost: 1,
  });
  expect(taps[0]).toBe('tab');
});

/**
 * Zeraora leads and faints to Glaceon. Of Latias and Gyarados, Glaceon hits Latias super effectively and not Gyarados,
 * so Gyarados goes in, off the prompt's second card. The first tap does not land, and the retap a second later goes to
 * the same card: decided again, with Gyarados already taken to be out, it went to Latias's. A retap that misses runs on
 * into a screen nothing recognises, so a regression ends `Lost` rather than tapping at the prompt for ever.
 *
 * The faint is caught once, on the prompt's first frame, by the prompt and by the Poké Balls it leaves in view, so the
 * frames kept are the prompt's two: the fight's was first seen more than a second before it, and Mamoswine's more than
 * a second after.
 */
test('retaps the card it chose when the first tap on the switch prompt does not land', async () => {
  const scenes: Record<string, Scene> = {
    ...battleAndBack(),
    party: { frame: fixture('menu-party-full'), tap: { at: [0.5, 0.87], to: 'loading' } },
    fight: { frame: fixture('battle-latias'), swipes: { count: 10, to: 'fainted' } },
    fainted: { frame: fixture('switch-glaceon'), lasts: { ms: 600, to: 'again' } },
    again: {
      frame: fixture('switch-glaceon'),
      tap: { at: [0.67, 0.87], to: 'next' },
      lasts: { ms: 3000, to: 'stuck' },
    },
    stuck: { frame: fixture('other-loss') },
    next: { frame: fixture('battle-minigame-mamoswine'), swipes: { count: 10, to: 'won' } },
  };
  const { phone, clock, taps } = scripted(scenes, 'party');
  const sceneOf = (frame: Image) => Object.keys(scenes).find((name) => scenes[name]?.frame === frame);
  const report = recorder();
  const kept: [string | undefined, number, string][] = [];

  expect(
    await run(
      phone,
      {
        mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
        data: DATA,
        icons: ICONS,
        typeIcons: TYPE_ICONS,
        count: 1,
        keep: (frame, at, event) => kept.push([sceneOf(frame), at, event]),
      },
      clock,
      report,
    ),
  ).toEqual({ battles: 1, won: 1, lost: 0 });
  expect(kept).toEqual([
    ['fainted', 7630, 'faint-own'],
    ['again', 8240, 'faint-own'],
  ]);
  expect(taps.filter((scene) => scene === 'fainted' || scene === 'again')).toEqual(['fainted', 'again']);
  expect(report.events.filter((line) => line.includes('sending in'))).toEqual([
    "own: Zeraora fainted; sending in Gyarados: the only one safe from Glaceon's moves",
  ]);
  expect(report.events.filter((line) => line.startsWith('run: battle 1'))).toEqual([
    'run: battle 1 started',
    'run: battle 1 won',
  ]);
});

/**
 * An opponent's charged move takes the battle off the screen for 2.2s: long enough for a menu read to start, its
 * screenshot due a second later at 3.5s. The battle is back at 3.2s, and is played from then, not from when the read
 * is done — which, awaited, held the fast moves up after every charged move.
 */
test('plays on as soon as the battle is back, without waiting for a menu read', async () => {
  const { phone, clock, strokes } = scripted(
    {
      fight: { frame: fixture('battle-deoxys'), lasts: { ms: 1000, to: 'pause' } },
      pause: { frame: fixture('other-vs-fade'), lasts: { ms: 2200, to: 'back' } },
      back: { frame: fixture('battle-deoxys'), lasts: { ms: 1000, to: 'gone' } },
      gone: { frame: fixture('other-white') },
    },
    'fight',
  );

  await expect(
    run(
      phone,
      {
        mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
        data: DATA,
        icons: ICONS,
        typeIcons: TYPE_ICONS,
      },
      clock,
    ),
  ).rejects.toBeInstanceOf(Lost);

  const resumed = strokes.find(({ scene }) => scene === 'back');

  expect(resumed?.at).toBeGreaterThanOrEqual(3200);
  expect(resumed?.at).toBeLessThan(3400);
});

/**
 * The battle's names and labels take 2s to read here, a second a band, from its first frame. The fight is swiped
 * throughout, one swipe straight after another from that frame on, and Sneasel is named only once the read is back.
 */
test('plays on while the battle’s names are read, rather than wait for them', async () => {
  const { phone, clock, strokes } = scripted(
    {
      fight: { frame: fixture('battle-deoxys'), lasts: { ms: 4000, to: 'gone' } },
      gone: { frame: fixture('other-white') },
    },
    'fight',
    () => 1000,
  );
  let named: { at: number; strokes: number } | undefined;

  await expect(
    run(
      phone,
      {
        mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
        data: DATA,
        icons: ICONS,
        typeIcons: TYPE_ICONS,
      },
      clock,
      {
        event: () => {},
        status: ({ fight }) => {
          if (fight?.opponent.species === 'Sneasel') {
            named ??= { at: clock.now(), strokes: strokes.length };
          }
        },
      },
    ),
  ).rejects.toBeInstanceOf(Lost);

  const before = strokes.slice(0, named?.strokes).map(({ at }) => at);
  const gaps = before.slice(1).map((at, i) => at - (before[i] ?? 0));

  expect(named?.at).toBeGreaterThanOrEqual(2000);
  expect(before[0]).toBe(0);
  expect(before.length).toBeGreaterThan(1);
  expect(new Set(gaps).size, 'swiped evenly, none held up').toBe(1);
});

test('stops on a Battle tab whose Training card never shows, rather than scroll it for ever', async () => {
  const { phone, clock, taps } = scripted(
    {
      main: { frame: fixture('menu-main'), tap: { at: [0.777, 0.5975], to: 'tab' } },
      tab: { frame: fixture('menu-battle-league') },
    },
    'main',
  );

  const lost = await run(
    phone,
    { mode: { mode: 'training', leader: 'blanche', league: 'ultra' }, data: DATA, icons: ICONS, typeIcons: TYPE_ICONS },
    clock,
  ).catch((error: unknown) => error);

  expect(lost).toBeInstanceOf(Lost);
  expect(taps).toEqual(['main']);
});

/**
 * Shadow Sneak thrown, its minigame's Ghost bubbles are swiped through rather than swept across in rows: every swipe in
 * it crosses the bubble low in the middle of `battle-minigame-giratina`.
 */
test('aims the minigame’s swipes at its bubbles', async () => {
  // Straight to Shadow Sneak's frame: the usual fight is Deoxys's, whose Zap Cannon would be read as the move thrown.
  const { phone, clock, strokes } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture('charged-shadow-sneak'), tap: { at: [0.499, 0.889], to: 'minigame' } },
    },
    'fight',
  );

  expect(
    await run(
      phone,
      {
        mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
        data: DATA,
        icons: ICONS,
        typeIcons: TYPE_ICONS,
        count: 1,
      },
      clock,
    ),
  ).toEqual({ battles: 1, won: 1, lost: 0 });

  const minigame = strokes.filter(({ scene }) => scene === 'minigame');

  expect(minigame.length).toBeGreaterThan(0);

  for (const { from, to } of minigame) {
    expect([from[1], to[1]].every((y) => y > 0.78 && y < 0.86)).toBe(true);
    expect(Math.min(from[0], to[0])).toBeLessThan(0.45);
    expect(Math.max(from[0], to[0])).toBeGreaterThan(0.45);
  }
});

/**
 * A throw waits for the fast move under way with its button lit, and a live run tapped it again a second on and told
 * the one throw twice. Whether the tap took or not, it is tried again each second the button stays lit, and told once.
 */
test.each([
  ['retaps a throw still waiting', { at: [0.499, 0.889] as Point, to: 'queued' }, ['fight', 'queued', 'result']],
  ['retries a tap that did not take', undefined, ['fight', 'fight', 'fight', 'fight', 'result']],
])('%s with the button still lit, telling the throw once', async (_, tap, tapped) => {
  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture('charged-shadow-sneak'), ...(tap && { tap }), lasts: { ms: 4000, to: 'minigame' } },
      queued: { frame: fixture('charged-shadow-sneak'), lasts: { ms: 1500, to: 'minigame' } },
    },
    'fight',
  );
  const report = recorder();

  expect(
    await run(
      phone,
      {
        mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
        data: DATA,
        icons: ICONS,
        typeIcons: TYPE_ICONS,
        count: 1,
      },
      clock,
      report,
    ),
  ).toEqual({ battles: 1, won: 1, lost: 0 });
  expect(taps).toEqual(tapped);
  expect(report.events.filter((line) => line.startsWith('own: threw'))).toEqual(['own: threw Shadow Sneak']);
});

/**
 * Moltres against Charizard in GO Battle League, as the user recorded it on a Pixel 8 Pro: Fly's tap moves on to
 * `tapped`, its minigame or the prompt for Charizard's Air Cutter on the same turn, which plays and puts up its banner
 * before `after`.
 */
function moltresFly(tapped: string, after: string): Record<string, Scene> {
  const fly = (to: string): Scene => ({ frame: fixture('charged-pixel8-fly'), tap: { at: [0.69, 0.895], to } });

  return {
    ...battleAndBack(),
    fight: fly(tapped),
    prompt: { frame: fixture('shield-pixel8-charizard'), lasts: { ms: 2000, to: 'away' } },
    away: { frame: fixture('other-vs-fade'), lasts: { ms: 5000, to: 'banner' } },
    banner: { frame: fixture('battle-banner-pixel8-charizard'), lasts: { ms: 2000, to: 'gap' } },
    gap: { frame: fixture('other-vs-fade'), lasts: { ms: 700, to: after } },
    relit: fly('minigame'),
    minigame: { frame: fixture('battle-minigame-pixel8-fly'), lasts: { ms: 6000, to: 'won' } },
  };
}

/** What is told of a throw: ours tapped again, thrown or not, and the opponent's. */
const throws = (events: readonly string[]) =>
  events.filter((line) => /^own: (threw|tap Fly|Fly)|threw a charged move$/.test(line));

/**
 * Where Air Cutter comes first, the tap can be dropped, Fly's button lit again once the field is back and the retap
 * thrown, or held back, its minigame following Air Cutter's banner with no tap of its own. Either way the one throw is
 * told once it plays, as one played at once is, and its minigame is swiped through its bubbles. Told at the tap, a
 * dropped tap would be two throws, and a held-back minigame would be swiped at as the fight.
 */
test.each([
  ['played', 'minigame', 'minigame', []],
  [
    'dropped',
    'prompt',
    'relit',
    ['opponent: Charizard threw a charged move', 'own: tap Fly again: its button still lit'],
  ],
  ['held back', 'prompt', 'minigame', ['opponent: Charizard threw a charged move']],
])('tells a throw %s once it plays, and swipes its minigame', async (_, tapped, after, before) => {
  const { phone, clock, strokes } = scripted(moltresFly(tapped, after), 'fight');
  const report = recorder();
  const [chain] = bubbleSwipes(fixture('battle-minigame-pixel8-fly'), typeColour(fixture('types/POKEMON_TYPE_FLYING')));

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons: ICONS,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
    report,
  );

  const last = strokes.filter(({ scene }) => scene === 'minigame').at(-1);

  expect(throws(report.events)).toEqual([...before, 'own: threw Fly']);
  expect(last && [last.from, last.to]).toEqual(chain);
});

// Moltres faints to Air Cutter before Fly plays: lost, and not told as thrown by the next of ours as it fights on.
test('loses a throw where ours faints before it plays', async () => {
  const { phone, clock } = scripted(
    {
      ...moltresFly('prompt', 'minigame'),
      away: { frame: fixture('other-vs-fade'), lasts: { ms: 5000, to: 'fainted' } },
      fainted: { frame: fixture('switch-pixel8'), lasts: { ms: 2000, to: 'next' } },
      next: { frame: fixture('battle-pixel8-moltres-body'), lasts: { ms: 5000, to: 'won' } },
    },
    'fight',
  );
  const report = recorder();

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons: ICONS,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
    report,
  );

  expect(throws(report.events)).toEqual([
    'opponent: Charizard threw a charged move',
    'own: Fly not thrown: Moltres fainted first',
  ]);
});

/**
 * Each stretch off the field told once the battle is back, with what showed: our Shadow Sneak's minigame and the move
 * playing after it, and, with our shields spent, a move of theirs that puts up no prompt. Shorter stretches and the
 * result's, which the battle never comes back from, are not told.
 */
test.each([
  [
    'charged-shadow-sneak',
    'run: off the battle for 10.1s: the minigame for our Shadow Sneak (5.1s), then the charged move playing (5.0s)',
  ],
  [
    'battle-shields-spent',
    "run: off the battle for 5.0s: likely Quaquaval's charged move, none of our shields left to prompt for",
  ],
])('tells how long the battle was off its field from %s', async (fight, said) => {
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: {
        frame: fixture(fight),
        tap: { at: [0.499, 0.889], to: 'minigame' },
        swipes: { count: 10, to: 'away' },
      },
      minigame: { frame: fixture('battle-minigame-giratina'), swipes: { count: 40, to: 'away' } },
      away: { frame: fixture('other-vs-fade'), lasts: { ms: 5000, to: 'back' } },
      back: { frame: fixture('battle-deoxys'), swipes: { count: 10, to: 'blip' } },
      blip: { frame: fixture('other-vs-fade'), lasts: { ms: 1000, to: 'last' } },
      last: { frame: fixture('battle-deoxys'), swipes: { count: 10, to: 'won' } },
    },
    'fight',
  );
  const report = recorder();

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons: ICONS,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
    report,
  );

  expect(report.events.filter((line) => line.includes('off the battle'))).toEqual([said]);
});

// The menus between the battles are no stretch off a battle's field, nor is the first battle's end, never come back from.
test('carries on into the next battle until the count is reached', async () => {
  const { phone, clock, taps } = scripted(battleAndBack(), 'training');
  const report = recorder();

  expect(
    await run(
      phone,
      {
        mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
        data: DATA,
        icons: ICONS,
        typeIcons: TYPE_ICONS,
        count: 2,
      },
      clock,
      report,
    ),
  ).toEqual({ battles: 2, won: 2, lost: 0 });
  expect(taps.filter((scene) => scene === 'result')).toHaveLength(2);
  expect(report.events.filter((line) => line.includes('off the battle'))).toEqual([]);
});

/**
 * Kyogre against Entei, with Avalanche lit and Hydro Pump not, and both of Entei's shields up: Avalanche costs 45 to
 * Hydro Pump's 75, so it goes now to draw a shield, where with the shields gone the fight would carry on until Hydro
 * Pump lit — `strategy.test.mts` holds that half.
 */
test('baits with the cheaper move while the opponent has shields', async () => {
  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      fight: {
        frame: fixture('charged-two-right'),
        tap: { at: [0.69, 0.889], to: 'minigame' },
        swipes: { count: 10, to: 'training' },
      },
    },
    'fight',
  );

  expect(
    await run(
      phone,
      {
        mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
        data: DATA,
        icons: ICONS,
        typeIcons: TYPE_ICONS,
        count: 1,
      },
      clock,
    ),
  ).toEqual({ battles: 1, won: 1, lost: 0 });
  expect(taps).toEqual(['fight', 'result']);
});

/** `image` with each box, as `[left, top, right, bottom]` in widths, filled with `colour`. */
function painted(image: Image, colour: readonly number[], ...boxes: (readonly number[])[]): Image {
  const data = image.data.slice();

  for (const [left = 0, top = 0, right = 0, bottom = 0] of boxes) {
    for (let y = Math.round(top * image.width); y < bottom * image.width; y++) {
      for (let x = Math.round(left * image.width); x < right * image.width; x++) {
        data.set([...colour, 255], (y * image.width + x) * 4);
      }
    }
  }

  return { ...image, data };
}

/** Where our first Poké Ball is on the Pixel 4 XL's frames, as a box for `painted`. */
const FIRST_BALL = [0.045, 0.19, 0.071, 0.215];

/** The minigame of `battleAndBack` with our first Poké Ball painted red, as the frames thrown from are. */
const minigameNoneFainted = (): Scene => ({
  frame: painted(fixture('battle-minigame-giratina'), [200, 60, 60], FIRST_BALL),
  swipes: { count: 40, to: 'won' },
});

/**
 * Giratina, CP 2392, with Shadow Sneak lit against a CP 2472 Mamoswine at 4%. With Mamoswine's shield hexagons painted
 * a spent one's purple, its throw is told as the finish it would be; with them up, a shield could stop it, and it is
 * thrown as the move held for. Our grey Poké Ball is painted red, on the minigame too, as if Giratina, the party's third
 * card, had led: read as a faint, it would be counted against Giratina, the one whose moves fit, leaving none of ours
 * known to be out, and the throw lost to it.
 */
test.each([
  ['spent', [[0.7, 0.195, 0.78, 0.222]], 'own: threw Shadow Sneak: would finish Mamoswine at 4%'],
  ['up', [], 'own: threw Shadow Sneak'],
])('with the opponent’s shields %s, a throw that would finish it says so', async (_, spent, said) => {
  const frame = painted(fixture('charged-shadow-sneak'), [200, 60, 60], FIRST_BALL);
  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: painted(frame, [111, 81, 118], ...spent), tap: { at: [0.499, 0.889], to: 'minigame' } },
      minigame: minigameNoneFainted(),
    },
    'party',
  );
  const report = recorder();

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons: ICONS,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
    report,
  );

  expect(taps).toContain('fight');
  expect(report.events.filter((line) => line.startsWith('own: threw'))).toEqual([said]);
});

/**
 * The same Giratina against Mamoswine with its shields spent, our fast moves seen taking it from 16%, once the battle's
 * first read has named it, to 10% and to the 4% the frame shows, steps 200ms apart, with Shadow Sneak's button painted
 * unlit until it lights at 4%; and one Powder Snow taking our 58% to 55%. One hit more finishes it, before that Powder
 * Snow's 8 energy and the 24 of three more, two landing in our longest fast move's three turns and one for the count,
 * reach Icicle Spear's 40. With Mamoswine's middle Poké Ball painted red, another is to come, and Shadow Sneak is held
 * for it; with Mamoswine its last, the finish is thrown.
 */
test.each([
  [
    'with another to come',
    [[0.879, 0.19, 0.905, 0.215]],
    ['own: holding Shadow Sneak for the next: fast moves finish Mamoswine at 4%'],
  ],
  ['on its last', [], ['own: threw Shadow Sneak: would finish Mamoswine at 4%']],
])('fast moves finishing the opponent %s hold the energy lit only for the next', async (_, next, said) => {
  const balls = painted(fixture('charged-shadow-sneak'), [200, 60, 60], FIRST_BALL, ...next);
  const hud = painted(balls, [111, 81, 118], [0.7, 0.195, 0.78, 0.222]);
  const hit = painted(hud, [105, 91, 41], [79 / 360, 220 / 360, 82 / 360, 225 / 360]);

  // Their fill run on to `px` of the bar's 100 at 360 wide, and Shadow Sneak's button with the top of its rim painted
  // over, the half `readyButtons` needs white gone.
  const theirs = (image: Image, px: number) =>
    painted(image, [229, 105, 103], [216 / 360, 265 / 360, (216 + px) / 360, 271 / 360]);
  const unlit = (image: Image) => painted(image, [107, 105, 112], [140 / 360, 635 / 360, 220 / 360, 676 / 360]);
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: unlit(theirs(hud, 16)), lasts: { ms: 400, to: 'closer' } },
      closer: { frame: unlit(theirs(hit, 10)), lasts: { ms: 200, to: 'charged' } },
      charged: { frame: hit, tap: { at: [0.499, 0.889], to: 'minigame' }, lasts: { ms: 3000, to: 'won' } },
      minigame: minigameNoneFainted(),
    },
    'party',
  );
  const report = recorder();

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons: ICONS,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
    report,
  );

  expect(report.events.filter((line) => /^own: (threw|holding)/.test(line))).toEqual(said);
});

/**
 * The game master with Shadow Sneak lowering our defense by 2 as Close Combat does: no committed frame has a move that
 * does lit with our shields spent and both sides' CPs read, but Giratina's against Mamoswine does with this one.
 */
const SNEAK_LOWERS: GameData = {
  ...DATA,
  combat: {
    ...DATA.combat,
    'Shadow Sneak': { ...DATA.combat['Shadow Sneak'], buffs: { chance: 1, ownDefense: -2 } },
  } as GameData['combat'],
};

/**
 * The same Giratina against Mamoswine, our shields spent and its two up, our grey Poké Ball painted red and each frame
 * then `paint`ed, through Mamoswine's Powder Snow taking our bar, repainted, down each of `bars` 200ms apart once the
 * battle's first read has named it, Shadow Sneak's button painted unlit; and then `lit`, our bar at the last of `bars`
 * and the button lit. Four hits, 32 energy, and one for the count afford Icicle Spear's 40, which takes 60% of a
 * rank-1 Giratina: survived from 80%, and not from 54%. `ours` is the frame with our bar run on to `px`.
 */
function sneaking(
  bars: readonly number[],
  lit: Omit<Scene, 'frame'>,
  paint = (image: Image) => image,
): { scenes: Record<string, Scene>; ours: (px: number) => Image } {
  const balls = paint(painted(fixture('charged-shadow-sneak'), [200, 60, 60], FIRST_BALL));

  // Our fill run on to `px` of the bar's 100 at 360 wide, and dark beyond it; and Shadow Sneak's button unlit, as in
  // the test above.
  const ours = (px: number) =>
    painted(
      painted(balls, [105, 91, 41], [22 / 360, 220 / 360, 122 / 360, 225 / 360]),
      [26, 255, 187],
      [22 / 360, 220 / 360, (22 + px) / 360, 225 / 360],
    );
  const unlit = (image: Image) => painted(image, [107, 105, 112], [140 / 360, 635 / 360, 220 / 360, 676 / 360]);
  const names = bars.map((_, i) => (i === 0 ? 'fight' : `hit${i}`));
  const hits = bars.map((px, i): [string, Scene] => [
    names[i] ?? '',
    { frame: unlit(ours(px)), lasts: { ms: i === 0 ? 400 : 200, to: names[i + 1] ?? 'lit' } },
  ]);

  return {
    scenes: {
      ...battleAndBack(),
      ...Object.fromEntries(hits),
      lit: { frame: ours(bars.at(-1) ?? 0), ...lit },
      minigame: minigameNoneFainted(),
    },
    ours,
  };
}

/** What is told of a hold and its throw, and of the opponent's throw meanwhile. */
const holds = (events: readonly string[]) =>
  events.filter((line) => /^own: (threw|holding|no longer holding)|threw a charged move/.test(line));

const HOLDING =
  'own: holding Shadow Sneak: Mamoswine can afford Icicle Spear, which we would survive; Icicle Spear would take ~60%, with 80% left, the hardest 40 energy affords';

/**
 * Held, Shadow Sneak goes once Mamoswine's Icicle Spear has landed, its countdown showing with no prompt and lowering
 * the count to 8, one hit's allowance, which affords nothing, our bar at 30% after it. Or once held as long as
 * Giratina's energy takes to fill from 50 at 8 a second, as any of its fast moves gains: 6.25s of the fight, the 3s off
 * the field between `lit` and `relit` not counting, so after the 6s the two last and before `late`, 0.5s after them,
 * ends. Or as a finish, Mamoswine's shields painted spent, takes its place, which ends the hold. Or as our bar, at 4%,
 * comes within one of Mamoswine's fast moves, `fastFaints`'s fear coming first of the reasons Icicle Spear would give
 * as well. Never on `lit` or `relit`, which take no tap.
 */
test.each([
  [
    'lands',
    { lasts: { ms: 2000, to: 'countdown' } },
    'back',
    [
      HOLDING,
      'opponent: Mamoswine threw a charged move: none of our shields left to prompt for',
      "own: no longer holding Shadow Sneak: 8 energy affords none of Mamoswine's charged moves",
      'own: threw Shadow Sneak',
    ],
  ],
  [
    'runs out of time',
    { lasts: { ms: 4000, to: 'gap' } },
    'late',
    [
      HOLDING,
      expect.stringMatching(
        /^own: no longer holding Shadow Sneak: 6\.(2[5-9]|30)s of the fight since the hold began, Giratina's energy filling from 50 in 6\.25s at the soonest$/,
      ),
      'own: threw Shadow Sneak',
    ],
  ],
  [
    'gives way to a finish',
    { lasts: { ms: 2000, to: 'finishing' } },
    'finishing',
    [
      HOLDING,
      'own: no longer holding Shadow Sneak: would finish Mamoswine at 4%',
      'own: threw Shadow Sneak: would finish Mamoswine at 4%',
    ],
  ],
  [
    'gives way to a fast move fainting us',
    { lasts: { ms: 2000, to: 'low' } },
    'low',
    [
      HOLDING,
      'own: no longer holding Shadow Sneak: their next fast move would faint us, one taking ~4% with 4% left',
      'own: threw Shadow Sneak',
    ],
  ],
])(
  'with no shield of ours left, a move lowering our defense is held until the hit it waits for %s',
  async (_, lit, tapped, said) => {
    const { scenes, ours } = sneaking([96, 92, 88, 84, 80], lit);
    const { phone, clock, taps } = scripted(
      {
        ...scenes,
        countdown: { frame: fixture('other-pixel8-countdown'), lasts: { ms: 3000, to: 'playing' } },
        playing: { frame: fixture('other-vs-fade'), lasts: { ms: 1000, to: 'back' } },
        back: { frame: ours(30), tap: { at: [0.499, 0.889], to: 'minigame' } },
        gap: { frame: fixture('other-vs-fade'), lasts: { ms: 3000, to: 'relit' } },
        relit: { frame: ours(80), lasts: { ms: 2000, to: 'late' } },
        late: { frame: ours(80), tap: { at: [0.499, 0.889], to: 'minigame' }, lasts: { ms: 500, to: 'won' } },
        low: { frame: ours(4), tap: { at: [0.499, 0.889], to: 'minigame' } },
        finishing: {
          frame: painted(ours(80), [111, 81, 118], [0.7, 0.195, 0.78, 0.222]),
          tap: { at: [0.499, 0.889], to: 'minigame' },
        },
      },
      'party',
    );
    const report = recorder();

    await run(
      phone,
      {
        mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
        data: SNEAK_LOWERS,
        icons: ICONS,
        typeIcons: TYPE_ICONS,
        count: 1,
      },
      clock,
      report,
    );

    expect(taps.filter((scene) => scene === 'lit' || scene === 'relit' || scene === tapped)).toEqual([tapped]);
    expect(holds(report.events)).toEqual(said);
  },
);

/**
 * Thrown at once, as above, where there is no hit to wait for: with our two shields painted held, one left to take
 * Icicle Spear; with Mamoswine's painted spent, Shadow Sneak finishing it at 4%; and from 54%, Icicle Spear fainting
 * us.
 */
test.each([
  [
    'a shield of ours left',
    [96, 92, 88, 84, 80],
    (image: Image) => painted(image, [224, 161, 238], [0.23, 0.2027, 0.242, 0.2153], [0.275, 0.2027, 0.287, 0.2153]),
    'own: threw Shadow Sneak',
  ],
  [
    'a finish',
    [96, 92, 88, 84, 80],
    (image: Image) => painted(image, [111, 81, 118], [0.7, 0.195, 0.78, 0.222]),
    'own: threw Shadow Sneak: would finish Mamoswine at 4%',
  ],
  ['a faint feared', [70, 66, 62, 58, 54], (image: Image) => image, 'own: threw Shadow Sneak'],
])('a move lowering our defense goes at once with %s', async (_, bars, paint, said) => {
  const { scenes } = sneaking(bars, { tap: { at: [0.499, 0.889], to: 'minigame' } }, paint);
  const { phone, clock, taps } = scripted(scenes, 'party');
  const report = recorder();

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: SNEAK_LOWERS,
      icons: ICONS,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
    report,
  );

  expect(taps).toContain('lit');
  expect(holds(report.events)).toEqual([said]);
});

/**
 * Kyogre against Entei in Master League with Avalanche lit, and with Entei's shield hexagons painted a spent one's
 * purple, Hydro Pump held for: worth more per energy, as `strategy.test.mts` has it. Our bar, its fill painted over
 * past the HP wanted, is seen to lose 12 points to one of Entei's fast moves once the battle's first read has named it.
 * Left within one more, Avalanche goes now rather than faint with its energy; left more, Hydro Pump is held for.
 */
test.each([
  [
    '13%',
    25,
    13,
    [
      'own: threw Avalanche: their next fast move would faint us, one taking ~12% with 13% left; not holding for Hydro Pump',
    ],
  ],
  ['28%', 40, 28, []],
])('with %s left, a lit move goes only once the next fast move would faint us', async (_, before, after, said) => {
  const spent = painted(fixture('charged-two-right'), [111, 81, 118], [0.7, 0.195, 0.78, 0.222]);
  const ours = (px: number) => painted(spent, [105, 91, 41], [(24 + px) / 360, 330 / 360, 91 / 360, 336 / 360]);
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: ours(before), lasts: { ms: 400, to: 'hit' } },
      hit: { frame: ours(after), tap: { at: [0.69, 0.889], to: 'minigame' }, lasts: { ms: 3000, to: 'won' } },
    },
    'fight',
  );
  const report = recorder();

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'master' },
      data: DATA,
      icons: ICONS,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
    report,
  );

  expect(report.events.filter((line) => line.startsWith('own: threw'))).toEqual(said);
});

/**
 * The opponent sends in another Pokémon with the HUD up throughout: Entei at 28% gives way to Salamence at 43%. A bar of
 * theirs fuller than before is a newcomer's, HP never coming back, so its name is read again at once rather than the
 * departed Entei's standing for up to `READ_MS`, its hits counted to Entei's energy. Until that read is back, as at the
 * battle's start, the opponent is named as nobody.
 */
test('reads the opponent again the moment a fuller bar says it was switched', async () => {
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture('battle-crunch-entei'), swipes: { count: 3, to: 'newcomer' } },
      newcomer: { frame: fixture('battle-crunch-salamence'), swipes: { count: 10, to: 'won' } },
    },
    'fight',
  );
  const report = recorder();

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons: ICONS,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
    report,
  );

  const newcomer = report.fights.filter(({ opponent }) => opponent.hp !== null && Math.round(opponent.hp * 100) === 43);

  expect(new Set(report.fights.map(({ opponent }) => opponent.species))).toEqual(new Set([null, 'Entei', 'Salamence']));
  expect(newcomer.length).toBeGreaterThan(0);
  expect(new Set(newcomer.map(({ opponent }) => opponent.species))).toEqual(new Set([null, 'Salamence']));
  expect(report.events, 'told, as a switch read the slow way is').toContain(
    'opponent: Entei fainted; sent in Salamence',
  );
});

/**
 * Entei's second read is slow, still under way when Salamence's fuller bar says it was sent in: Salamence's own read,
 * begun then, is back first. Entei's, back after it, is of the Pokémon before, and is dropped rather than name Entei,
 * with its CP, over Salamence until the next read.
 */
test('drops a read begun before a newcomer was sent in, rather than let it stand for the newcomer', async () => {
  const sentIn = 3500;
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture('battle-crunch-entei'), lasts: { ms: sentIn, to: 'newcomer' } },
      newcomer: { frame: fixture('battle-crunch-salamence'), lasts: { ms: 4000, to: 'won' } },
    },
    'fight',
    (at) => (at < sentIn ? 1000 : OCR_MS),
  );
  const report = recorder();

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons: ICONS,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
    report,
  );

  const of = (species: string) => report.fights.filter(({ opponent }) => opponent.species === species);
  const newcomer = report.fights.filter(({ opponent }) => opponent.hp !== null && Math.round(opponent.hp * 100) === 43);
  const enteiCp = of('Entei')[0]?.opponent.cp;

  expect(enteiCp).toEqual(expect.any(Number));
  expect(of('Salamence').length).toBeGreaterThan(0);
  expect(new Set(newcomer.map(({ opponent }) => opponent.species))).toEqual(new Set([null, 'Salamence']));
  expect(newcomer.map(({ opponent }) => opponent.cp)).not.toContain(enteiCp);
  expect(report.events.filter((line) => line.startsWith('opponent: ') && !line.includes('shielded'))).toEqual([
    'opponent: Entei fainted; sent in Salamence',
  ]);
});

/**
 * A battle against Sneasel ends with its only read still under way, back once the menus are showing. It is of the
 * battle before, and is dropped rather than name Sneasel as the next battle's opponent, Entei, until Entei's own read.
 */
test('drops a read still under way as its battle ends, rather than carry it into the next', async () => {
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      sneasel: { frame: fixture('battle-deoxys'), lasts: { ms: 500, to: 'won' } },
      fight: { frame: fixture('battle-crunch-entei'), lasts: { ms: 4000, to: 'won' } },
    },
    'sneasel',
    (at) => (at < 500 ? 1000 : OCR_MS),
  );
  const report = recorder();

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons: ICONS,
      typeIcons: TYPE_ICONS,
      count: 2,
    },
    clock,
    report,
  );

  const named = new Set(report.fights.map(({ opponent }) => opponent.species));

  expect(named).toContain('Entei');
  expect(named).not.toContain('Sneasel');
  expect(report.events.filter((line) => line.startsWith('opponent: ') && !line.includes('shielded'))).toEqual([]);
});

/**
 * Glaceon, with all three of the opponent's Poké Balls red, gives way to another species: with one gone grey, Salamence
 * after it fainted; with all three still red, Sneasel switched in. Entei giving way to Salamence's fuller bar is read
 * again at once, its name cleared for the newcomer's, and is still told as the one Salamence replaced.
 */
test.each([
  ['battle-latias', 'battle-crunch-salamence', 'opponent: Glaceon fainted; sent in Salamence'],
  ['battle-latias', 'battle-deoxys', 'opponent: switched to Sneasel'],
  ['battle-crunch-entei', 'battle-crunch-salamence', 'opponent: Entei fainted; sent in Salamence'],
])('tells the opponent fainting from its switching out, by its Poké Balls: %s to %s', async (before, after, said) => {
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture(before), swipes: { count: 10, to: 'after' } },
      after: { frame: fixture(after), lasts: { ms: 4000, to: 'won' } },
    },
    'fight',
  );
  const report = recorder();

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons: ICONS,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
    report,
  );

  expect(report.events.filter((line) => line.startsWith('opponent: ') && !line.includes('shielded'))).toEqual([said]);
  expect(report.fights.at(0)?.opponent.left).toBe(3);
});

/**
 * Sneasel, CP 1465, switches to Glaceon, whose CP is painted over so that no read finds it and whose bar, emptier than
 * Sneasel's, clears nothing. Live, Gengar went on at Charizard's CP 2285 for fifteen reads after the switch.
 */
test('reads a switched-in opponent’s CP afresh rather than keeping the one before’s', async () => {
  const glaceon = fixture('battle-latias');

  // The `CP` of `CP 2412`, from x 218, under the panel beside it: its digits are left, which the HUD is told from by
  // the text along it, and which match no CP without the letters before them.
  for (let y = 49; y < 69; y++) {
    const row = y * glaceon.width;

    for (let x = 216; x < 234; x++) {
      glaceon.data.copyWithin((row + x) * 4, (row + 214) * 4, (row + 215) * 4);
    }
  }

  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture('battle-deoxys'), swipes: { count: 10, to: 'after' } },
      after: { frame: glaceon, lasts: { ms: 4000, to: 'won' } },
    },
    'fight',
  );
  const report = recorder();

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons: ICONS,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
    report,
  );

  const cps = (species: string) =>
    new Set(report.fights.filter(({ opponent }) => opponent.species === species).map(({ opponent }) => opponent.cp));

  expect(report.events).toContain('opponent: switched to Glaceon');
  expect(cps('Sneasel')).toEqual(new Set([1465]));
  expect(cps('Glaceon')).toEqual(new Set([null]));
});

/**
 * The opponent switches Glaceon out for Golem, its three Poké Balls still red, with no type icons to read its form by:
 * either Golem it could be, and a Kantonian one's Earthquake threatens the Pokémon we have out. Latias, second of the
 * party and so the bench's top card, is safe from either Golem's moves, and its Aura Sphere hits both super
 * effectively: it is switched in once Golem has flown in. Golem's first frame follows a stretch of `other`, so is read
 * at once, its last read being `READ_MS` ago; and it flies in for `flying` milliseconds after, taking no tap meanwhile,
 * which a tap through it, bench or throw, shows as one of `flying`'s. Taken where the next read, naming neither Gengar
 * nor Latias, finds our CP changed. Flying in for longer than the run waits, the tap is dropped, which the next read
 * shows by the HUD naming Gengar still, its `CP` painted out so that its CP goes unread, as Palkia's did live: no
 * switch of ours having started the switch timer, it is told as dropped and tapped again. Zeraora's icon stands for
 * Gengar on the party screen, so that it is Gengar, Latias and Gyarados.
 */
test.each([
  ['taken', 1500, [], []],
  [
    'dropped by a longer flight',
    3000,
    ['flying'],
    [
      'own: Latias not sent in: taken as dropped, no switch of ours in the last 45s',
      "own: switching to Latias against Golem: Gengar is hit super effectively; Aura Sphere is, and nothing of Golem's is",
    ],
  ],
])('switches to a counter once the opponent switched in has flown in: %s', async (_, flying, dropped, told) => {
  const bench: Point = [0.903, 0.608];
  const icons = ICONS.map((icon) => ({ ...icon, species: icon.species === 'Zeraora' ? 'Gengar' : icon.species }));
  const golem = painted(fixture('battle-gengar-label-short'), [244, 249, 251], [0.27, 0.148, 0.315, 0.185]);
  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      party: { frame: fixture('menu-party-full'), tap: { at: [0.5, 0.87], to: 'loading' } },
      loading: { frame: fixture('other-vs-fade'), lasts: { ms: 4000, to: 'glaceon' } },
      glaceon: { frame: fixture('battle-latias'), swipes: { count: 10, to: 'coming' } },
      coming: { frame: fixture('other-vs-fade'), lasts: { ms: 3200, to: 'flying' } },
      flying: { frame: golem, lasts: { ms: flying, to: 'golem' } },
      golem: { frame: golem, tap: { at: bench, to: 'after' }, lasts: { ms: 6000, to: 'won' } },
      after: { frame: fixture('battle-crunch-entei'), lasts: { ms: 6000, to: 'won' } },
    },
    'party',
  );
  const report = recorder();

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons,
      typeIcons: {},
      count: 1,
    },
    clock,
    report,
  );

  const switching = report.events.filter((line) => line.startsWith('own: switching') || line.includes('not sent in'));

  expect(taps.filter((scene) => scene === 'flying' || scene === 'golem')).toEqual([...dropped, 'golem']);
  expect(switching).toEqual([
    "own: switching to Latias against Golem: Gengar is hit super effectively; Aura Sphere is, and nothing of Golem's is",
    ...told,
  ]);
});

const ZERAORA =
  "own: switching to Zeraora against Glaceon: Latias is hit super effectively; Dynamic Punch is, and nothing of Glaceon's is";
const DROPPED = 'own: Zeraora not sent in: taken as dropped, no switch of ours in the last 45s';

/**
 * Latias switched in against Golem as above, Entei comes in for `entei` milliseconds, Latias's Psychic read against it,
 * and then Glaceon, its moves super effective against Latias: Zeraora, whose Dynamic Punch is against Glaceon, is
 * tapped once it has flown in. Glaceon's frame names no species of ours, only CP 2458, so the next read judges the tap
 * by that CP, unchanged. Within `TIMER_MS` of Latias's switch, that is the timer refusing the tap. After it, the tap
 * was dropped, and is tapped once more; dropped again, it is left.
 */
test.each([
  ['running', 10_000, [ZERAORA, 'own: Zeraora not sent in: the switch timer is running']],
  ['run out', 50_000, [ZERAORA, DROPPED, ZERAORA, DROPPED]],
])('tells a switch refused with our switch timer %s', async (_, entei, told) => {
  const bench: Point = [0.903, 0.608];
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      party: { frame: fixture('menu-party-full'), tap: { at: [0.5, 0.87], to: 'loading' } },
      loading: { frame: fixture('other-vs-fade'), lasts: { ms: 4000, to: 'glaceon' } },
      glaceon: { frame: fixture('battle-latias'), swipes: { count: 10, to: 'golem' } },
      golem: { frame: fixture('battle-gengar-label-short'), tap: { at: bench, to: 'entei' } },
      entei: { frame: fixture('battle-night'), lasts: { ms: entei, to: 'back' } },
      back: { frame: fixture('battle-latias'), lasts: { ms: 8000, to: 'won' } },
    },
    'party',
  );
  const report = recorder();

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons: ICONS,
      typeIcons: {},
      count: 1,
    },
    clock,
    report,
  );

  expect(
    report.events.filter((line) => line.startsWith('own: Zeraora') || line.startsWith('own: switching to Zeraora')),
  ).toEqual(told);
});

/** The same Golem read by its type icons, Rock and Electric: an Alolan one, nothing of which threatens Gengar. */
test('stays in when the type icons show a form that does not threaten ours', async () => {
  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      party: { frame: fixture('menu-party-full'), tap: { at: [0.5, 0.87], to: 'loading' } },
      loading: { frame: fixture('other-vs-fade'), lasts: { ms: 4000, to: 'glaceon' } },
      glaceon: { frame: fixture('battle-latias'), swipes: { count: 10, to: 'golem' } },
      golem: { frame: fixture('battle-gengar-label-short'), lasts: { ms: 6000, to: 'won' } },
    },
    'party',
  );

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons: ICONS,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
  );

  expect(taps.filter((scene) => scene === 'golem')).toEqual([]);
});

/** Glaceon gives way to Sneasel, which no card of ours counters, a Hisuian one's Close Combat beating Mamoswine. */
test('stays in when nothing benched counters the opponent switched in', async () => {
  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      loading: { frame: fixture('other-vs-fade'), lasts: { ms: 4000, to: 'glaceon' } },
      glaceon: { frame: fixture('battle-latias'), swipes: { count: 10, to: 'sneasel' } },
      sneasel: { frame: fixture('battle-deoxys'), lasts: { ms: 6000, to: 'won' } },
    },
    'party',
  );

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons: ICONS,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
  );

  expect(taps.filter((scene) => scene === 'sneasel')).toEqual([]);
});

const HELD = [0.236, 0.281].map((x) => [x - 0.008, 0.2, x + 0.008, 0.218]);
const STAYED = 'own: staying in against Mamoswine: Shadow Sneak drawn into a shield before Giratina faints';

/**
 * The opponent switches Glaceon out for Mamoswine while our Giratina has Shadow Sneak lit. Mamoswine's Avalanche
 * threatens Giratina, and nothing benched counters Mamoswine, but Umbreon is safe from all of its moves: Giratina
 * switches to it rather than throw, keeping the energy on the bench. There being no committed party of these, the party
 * screen is read with Zeraora's icon standing for Umbreon and Gyarados' for Giratina, so the party is Umbreon, Latias
 * and Giratina, and Umbreon the bench's top card. Mamoswine's frame is of a later battle, its Poké Balls painted red so
 * that it, like Glaceon's, shows all three of each side's left, and the change reads as a switch rather than a faint.
 * The switch shows only as `other` before Mamoswine's first frame, which so reads the HUD at once, its last read being
 * `READ_MS` ago.
 *
 * Giratina's own shields are spent on the frame as recorded, and Mamoswine's moves would faint it: doomed, it stays in
 * and throws Shadow Sneak into Mamoswine's shield. Painted held, it has a shield to take, and banks. Painted held only
 * for the first second, as though spent while Mamoswine flies in, the switch decided on is given up as Giratina comes
 * to be doomed, before its tap, and it stays in and throws.
 */
test.each([
  ['spent', [], undefined, [STAYED], []],
  [
    'held',
    HELD,
    undefined,
    [],
    [
      "own: switching to Umbreon against Mamoswine, banking Shadow Sneak: Giratina is hit super effectively and banks its energy; Umbreon is safe from Mamoswine's moves",
    ],
  ],
  ['spent as it flies in', HELD, 1000, [STAYED], []],
])(
  'with our shields %s, a lit move against an opponent switched in is thrown or banked',
  async (_, held, spentAfter, stayed, switched) => {
    const stand = { Zeraora: 'Umbreon', Gyarados: 'Giratina' } as Record<string, string>;
    const icons = ICONS.map((icon) => ({ ...icon, species: stand[icon.species] ?? icon.species }));
    const balls = [0.058, 0.111, 0.161, 0.842, 0.892, 0.944].map((x) => [x - 0.01, 0.192, x + 0.01, 0.213]);
    const red = painted(fixture('charged-shadow-sneak'), [220, 40, 40], ...balls);
    const mamoswine = painted(red, [224, 161, 238], ...held);
    const bench = place(BENCH[0] ?? [0, 0], BENCH_ANCHOR, mamoswine);
    const { phone, clock, taps } = scripted(
      {
        ...battleAndBack(),
        party: { frame: fixture('menu-party-full'), tap: { at: [0.5, 0.87], to: 'loading' } },
        loading: { frame: fixture('other-vs-fade'), lasts: { ms: 4000, to: 'glaceon' } },
        glaceon: { frame: fixture('battle-latias'), swipes: { count: 10, to: 'coming' } },
        coming: { frame: fixture('other-vs-fade'), lasts: { ms: 3200, to: 'mamoswine' } },
        mamoswine: {
          frame: mamoswine,
          tap: { at: bench, to: 'won' },
          lasts: spentAfter === undefined ? { ms: 6000, to: 'won' } : { ms: spentAfter, to: 'spent' },
        },
        spent: { frame: red, tap: { at: bench, to: 'won' }, lasts: { ms: 6000, to: 'won' } },
      },
      'party',
    );
    const report = recorder();

    await run(
      phone,
      {
        mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
        data: DATA,
        icons,
        typeIcons: TYPE_ICONS,
        count: 1,
      },
      clock,
      report,
    );

    expect(taps).toContain(spentAfter === undefined ? 'mamoswine' : 'spent');
    expect(report.events.filter((line) => line.startsWith('own: staying'))).toEqual(stayed);
    expect(report.events.filter((line) => line.startsWith('own: switching'))).toEqual(switched);
  },
);

/**
 * Latias leads, from the party screen, and faints to Glaceon; the switch prompt's first card sends in Mamoswine, the
 * next of the party. No frame here shows a move label or our species, so the party is all that names either. Glaceon
 * is named once the battle's first read is back.
 */
test('names the lead from the party, and the next of it after a faint', async () => {
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture('battle-latias'), swipes: { count: 10, to: 'fainted' } },
      fainted: { frame: fixture('switch-glaceon'), tap: { at: [0.33, 0.87], to: 'next' } },
      next: { frame: fixture('battle-minigame-mamoswine'), swipes: { count: 10, to: 'won' } },
    },
    'party',
  );
  const report = recorder();

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons: ICONS,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
    report,
  );

  const named = new Set(report.fights.map(({ own, opponent }) => `${own.species} against ${opponent.species}`));

  expect([...named]).toEqual(['Latias against null', 'Latias against Glaceon', 'Mamoswine against Glaceon']);
});

/**
 * Latias faints to Glaceon, and the switch prompt reads as the fight for the odd frame as it slides in and out, as
 * Palkia's did replayed off a live run's video: a frame of it, 110ms of the fight, the prompt until it is tapped, and
 * as it goes, 90ms of the fight and a last frame of it. Ended by the first frame of the fight, the prompt was owed
 * nothing after it, and went untapped: live until the game's timer picked, here until the run ends `Lost`.
 */
test('answers a switch prompt that reads as the fight for a frame as it slides in and out', async () => {
  const latias = fixture('battle-latias');
  const prompt = fixture('switch-glaceon');
  const scenes: Record<string, Scene> = {
    ...battleAndBack(),
    fight: { frame: latias, swipes: { count: 10, to: 'sliding' } },
    sliding: { frame: prompt, lasts: { ms: 20, to: 'flicker' } },
    flicker: { frame: latias, lasts: { ms: 110, to: 'fainted' } },
    fainted: { frame: prompt, tap: { at: [0.33, 0.87], to: 'leaving' }, lasts: { ms: 3000, to: 'stuck' } },
    leaving: { frame: prompt, lasts: { ms: 500, to: 'fading' } },
    fading: { frame: latias, lasts: { ms: 90, to: 'gone' } },
    gone: { frame: prompt, lasts: { ms: 20, to: 'next' } },
    stuck: { frame: fixture('other-loss') },
    next: { frame: fixture('battle-minigame-mamoswine'), swipes: { count: 10, to: 'won' } },
  };
  const { phone, clock, taps, strokes } = scripted(scenes, 'party');
  const report = recorder();

  expect(
    await run(
      phone,
      {
        mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
        data: DATA,
        icons: ICONS,
        typeIcons: TYPE_ICONS,
        count: 1,
      },
      clock,
      report,
    ),
  ).toEqual({ battles: 1, won: 1, lost: 0 });

  const named = new Set(report.fights.map(({ own, opponent }) => `${own.species} against ${opponent.species}`));

  expect(taps).toEqual(['party', 'fainted', 'result']);
  expect(strokes.map(({ scene }) => scene)).toEqual(expect.arrayContaining(['flicker', 'fading']));
  expect(report.events.filter((line) => line.startsWith('own: ') && line.includes('fainted'))).toEqual([
    "own: Latias fainted; sending in Mamoswine: none safe from Glaceon's moves; hits hardest (Stone Edge)",
  ]);
  expect([...named].at(-1)).toBe('Mamoswine against Glaceon');
});

/**
 * What matches the switch prompt with all three of our Poké Balls red follows no faint, and is not answered as one: live,
 * a charged move's burst over a night field was, and Mewtwo was told as fainted for a battle it fought on in. Here the
 * prompt itself, its grey ball painted red, stands in for it, `recognise` no longer reading that burst as the prompt.
 */
test('answers no switch prompt while all three of our Poké Balls are red', async () => {
  const prompt = fixture('switch-glaceon');
  const ball = { x: Math.round(0.058 * prompt.width), y: Math.round(0.2026 * prompt.width) };
  const painted = { ...prompt, data: prompt.data.slice() };

  for (let y = ball.y - 4; y <= ball.y + 4; y++) {
    for (let x = ball.x - 4; x <= ball.x + 4; x++) {
      painted.data.set([220, 40, 40, 255], (y * painted.width + x) * 4);
    }
  }

  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture('battle-latias'), swipes: { count: 10, to: 'slate' } },
      slate: { frame: painted, tap: { at: [0.33, 0.87], to: 'stuck' }, lasts: { ms: 3000, to: 'won' } },
      stuck: { frame: fixture('other-loss') },
    },
    'party',
  );
  const report = recorder();

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons: ICONS,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
    report,
  );

  expect(taps).not.toContain('slate');
  expect(report.events.filter((line) => line.includes('fainted'))).toEqual([]);
});

/**
 * Latias leads and faints with no switch prompt to answer, as where the game's timer picks or the prompt goes
 * unrecognised: the battle comes back with one of our Poké Balls grey. Counted only off our taps, Latias stayed out to
 * the end of a live run, the next faint told against it.
 */
test('counts a faint off our Poké Balls where no switch prompt is answered for it', async () => {
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture('battle-latias'), swipes: { count: 10, to: 'next' } },
      next: { frame: fixture('battle-minigame-mamoswine'), swipes: { count: 10, to: 'won' } },
    },
    'party',
  );
  const report = recorder();

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons: ICONS,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
    report,
  );

  const named = new Set(report.fights.map(({ own, opponent }) => `${own.species} against ${opponent.species}`));

  expect(report.events.filter((line) => line.startsWith('own: ') && line.includes('fainted'))).toEqual([
    'own: Latias fainted: one fewer of our Poké Balls',
  ]);
  expect([...named]).toEqual(['Latias against null', 'Latias against Glaceon', 'Mamoswine against Glaceon']);
});

/**
 * Kyogre leads, Hydro Pump and Avalanche read under its buttons, and faints with no switch prompt to answer, as where
 * the game sends the last one in, its timer picks or the prompt goes unrecognised: Mamoswine comes in with one of our
 * Poké Balls grey. Kept, Kyogre's moves would stand for Mamoswine's, and fitting none still standing, name neither.
 * Latias's icon stands for Kyogre's, there being no committed party with it.
 */
test('forgets the moves of one of ours fainting with no switch prompt', async () => {
  const icons = ICONS.map((icon) => ({ ...icon, species: icon.species === 'Latias' ? 'Kyogre' : icon.species }));
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture('battle-two-unlit'), swipes: { count: 10, to: 'next' } },
      next: { frame: fixture('battle-minigame-mamoswine'), swipes: { count: 10, to: 'won' } },
    },
    'party',
  );
  const report = recorder();

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
    report,
  );

  const fights = new Set(report.fights.map(({ own, moves }) => `${own.species}: ${moves.join(', ') || '?'}`));

  expect([...fights]).toEqual(['Kyogre: ?', 'Kyogre: Hydro Pump, Avalanche', 'Mamoswine: ?']);
});

/**
 * Latias leads with Hydro Pump read under its buttons, which none of our party can hold, as a label misread: live, our
 * name unread, `TIVE` beneath Xerneas's Moonblast read as Dive. It faints with no switch prompt, and Mamoswine comes in
 * with one of our Poké Balls grey. Counted only where the moves read fit one of ours, the faint went untold, and the
 * misread moves stood for Mamoswine's.
 */
test('counts a faint off our Poké Balls where the moves read fit none of ours', async () => {
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture('battle-two-unlit'), swipes: { count: 10, to: 'next' } },
      next: { frame: fixture('battle-minigame-mamoswine'), swipes: { count: 10, to: 'won' } },
    },
    'party',
  );
  const report = recorder();

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons: ICONS,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
    report,
  );

  const fights = new Set(report.fights.map(({ own, moves }) => `${own.species}: ${moves.join(', ') || '?'}`));

  expect(report.events.filter((line) => line.startsWith('own: ') && line.includes('fainted'))).toEqual([
    'own: Latias fainted: one fewer of our Poké Balls',
  ]);
  expect([...fights]).toEqual(['Latias: ?', 'null: Hydro Pump, Avalanche', 'Mamoswine: ?']);
});

/**
 * Gengar leads, named in the HUD, and faints with no switch prompt to answer: one of our Poké Balls goes grey with the
 * HUD naming Gengar on for a second, as live it named Palkia through the switch prompt after Palkia fainted. Then one
 * nicknamed `##` comes in, a name matching no species, as Xerneas's `Xemeas` matched none. Merged as read, Gengar's
 * name stood for the one sent in for as long as it fought. Latias's icon stands for Gengar's, there being no committed
 * party with it.
 */
test('takes no read naming one of ours that has fainted for the one sent in', async () => {
  const icons = ICONS.map((icon) => ({ ...icon, species: icon.species === 'Latias' ? 'Gengar' : icon.species }));
  const gengar = fixture('battle-gengar-label-short');
  const grey = (image: Image) => painted(image, [105, 65, 68], FIRST_BALL);
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: gengar, swipes: { count: 10, to: 'fainting' } },
      fainting: { frame: grey(gengar), lasts: { ms: 1000, to: 'next' } },
      next: { frame: grey(fixture('battle-latias')), swipes: { count: 10, to: 'won' } },
    },
    'party',
  );
  const report = recorder();

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
    report,
  );

  const named = new Set(report.fights.map(({ own }) => `${own.species} at CP ${own.cp}`));

  expect(report.events.filter((line) => line.startsWith('own: ') && line.includes('fainted'))).toEqual([
    'own: Gengar fainted: one fewer of our Poké Balls',
  ]);
  expect([...named]).toEqual([
    'Gengar at CP null',
    'Gengar at CP 2392',
    'Mamoswine at CP null',
    'Mamoswine at CP 2458',
  ]);
});

/**
 * Gengar leads and faints as before, but the one sent in is a second Gengar, Mamoswine's icon standing for it, so the
 * HUD naming the fainted one's species is also naming the one out. Once the stale HUD's while has gone by, its reads
 * stand: dropped for naming a fainted species, the second Gengar's CP would never have been read.
 */
test('takes a read naming a fainted species once the HUD has had time to change', async () => {
  const icons = ICONS.map((icon) => ({
    ...icon,
    species: icon.species === 'Latias' || icon.species === 'Mamoswine' ? 'Gengar' : icon.species,
  }));
  const gengar = fixture('battle-gengar-label-short');
  const greyed = painted(gengar, [105, 65, 68], FIRST_BALL);
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: gengar, swipes: { count: 10, to: 'fainting' } },
      fainting: { frame: greyed, lasts: { ms: 1000, to: 'next' } },
      next: { frame: greyed, swipes: { count: 40, to: 'won' } },
    },
    'party',
  );
  const report = recorder();

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
    report,
  );

  const told = report.events.includes('own: Gengar fainted: one fewer of our Poké Balls');
  const after = report.fights.slice(-1).map(({ own }) => `${own.species} at CP ${own.cp}`);

  expect(told).toBe(true);
  expect(after).toEqual(['Gengar at CP 2392']);
});

/**
 * A shield prompt is tapped while we have a shield left, and left to run out once both are spent: tapped, it would be
 * a tap at a prompt with nothing behind it. Latias leads with both shields up; Charizard has spent both.
 */
test.each([
  ['battle-latias', ['prompt']],
  ['battle-shields-spent', []],
])('after %s, the shield prompt is tapped in %j', async (fight, tapped) => {
  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture(fight), swipes: { count: 10, to: 'prompt' } },
      prompt: { frame: fixture('shield-glaceon'), tap: { at: [0.5, 0.82], to: 'won' }, lasts: { ms: 3000, to: 'won' } },
    },
    'fight',
  );

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons: ICONS,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
  );

  expect(taps.filter((scene) => scene === 'prompt')).toEqual(tapped);
});

/** Where Charizard's bar ends on `battle-charizard-magmar`, at 93%, and two points of it short of there, as a box. */
const CHARIZARD_HIT = [114 / 360, 243 / 360, 117 / 360, 248 / 360];

/** Where the right of our two shields is on the Pixel 4 XL's frames, as a box for `painted`: it goes first. */
const OUR_SECOND_SHIELD = [0.273, 0.2, 0.289, 0.218];

/**
 * Charizard against Magmar as `battle-charizard-magmar` shows them, then one of Magmar's fast moves landing on
 * Charizard, a 2-point step as Ember's or Karate Chop's 3 of its 149 HP is, and then `prompt`. With `spent`, Charizard
 * has spent one of its shields throughout.
 */
function charizardHit(prompt: Image, spent = false): Record<string, Scene> {
  const fight = spent
    ? painted(fixture('battle-charizard-magmar'), [111, 81, 118], OUR_SECOND_SHIELD)
    : fixture('battle-charizard-magmar');

  return {
    fight: { frame: fight, lasts: { ms: 1000, to: 'hit' } },
    hit: { frame: painted(fight, [52, 86, 97], CHARIZARD_HIT), swipes: { count: 10, to: 'prompt' } },
    prompt: { frame: prompt, tap: { at: [0.5, 0.82], to: 'won' }, lasts: { ms: 3000, to: 'won' } },
  };
}

/**
 * Charizard, CP 2495, against Magmar, CP 1826, in the Ultra League, as played live: Magmar's hardest charged move, Fire
 * Blast, takes about half of Charizard, and its fast moves 2 points. Fire Blast's 80 energy is nine of them at 9 apiece
 * and one more for margin, 20% of Charizard. At 86% with both shields, the 38% Fire Blast would leave is less than
 * twice that, and the shield is taken; with one, it is more, and the shield kept. At 9% it is taken against a hit that
 * would faint Charizard, where live it was not and Charizard fainted to it. Each says why.
 */
test.each([
  [
    'shield-charizard-high',
    false,
    ['prompt'],
    'own: took shield: Fire Blast would take ~48%, with 86% left; leaves ~38%, no more than 2 × the ~20% of 10 ' +
      'fast moves before their next charged move',
  ],
  [
    'shield-charizard-high',
    true,
    [],
    'own: kept shield: Fire Blast would take ~48%, with 86% left; leaves ~38%, more than the ~20% of 10 fast moves ' +
      'before their next charged move',
  ],
  ['shield-low', false, ['prompt'], 'own: took shield: Fire Blast would take ~48%, with 9% left; that would faint us'],
])('at %s with one shield spent %s, the shield is tapped in %j', async (prompt, spent, tapped, said) => {
  const { phone, clock, taps } = scripted({ ...battleAndBack(), ...charizardHit(fixture(prompt), spent) }, 'fight');
  const report = recorder();

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons: ICONS,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
    report,
  );

  expect(taps.filter((scene) => scene === 'prompt')).toEqual(tapped);
  expect(report.events.filter((line) => line.includes(' shield'))).toEqual([said]);
});

/**
 * The same prompt at 86% with one shield left, every other frame of it reading as 9%, as Dialga's bar flickered
 * between 64% and 2% live: a misread snapping back is no hit, so the shield is kept, the 38% Fire Blast would leave
 * outlasting Magmar's fast moves before its next.
 */
test('keeps the shield through a prompt whose bar flickers low', async () => {
  const high = fixture('shield-charizard-high');
  const low = fixture('shield-low');
  const { phone, clock, taps } = scripted({ ...battleAndBack(), ...charizardHit(high, true) }, 'fight');
  let frames = 0;
  const flickering: Phone = {
    ...phone,
    frame: () => {
      const frame = phone.frame();

      return frame === high && frames++ % 2 === 1 ? low : frame;
    },
  };
  const report = recorder();

  await run(
    flickering,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons: ICONS,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
    report,
  );

  expect(taps.filter((scene) => scene === 'prompt')).toEqual([]);
  expect(report.events.filter((line) => line.includes(' shield'))).toEqual([
    'own: kept shield: Fire Blast would take ~48%, with 86% left; leaves ~38%, more than the ~20% of 10 fast moves ' +
      'before their next charged move',
  ]);
});

// Charizard against Quaquaval: the banner after the prompt names Quaquaval's move, which is kept for the battle.
test('learns the move the banner after a shield prompt names', async () => {
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture('battle-one-shield'), swipes: { count: 10, to: 'prompt' } },
      prompt: { frame: fixture('shield-low'), lasts: { ms: 3000, to: 'banner' } },
      banner: { frame: fixture('battle-banner-quaquaval'), lasts: { ms: 2000, to: 'won' } },
    },
    'fight',
  );
  const report = recorder();

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons: ICONS,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
    report,
  );

  expect(report.events).toContain('opponent: Quaquaval has Aqua Jet');
});

/**
 * Moltres against Greninja in GO Battle League with none of our shields left, as recorded off a Pixel 8 Pro: Greninja's
 * Hydro Cannon puts up no prompt, only its countdown, which is counted as its throw, once for all its frames, and is
 * followed by the banner naming the move. With our shields still up, as against Typhlosion, a prompt is what a throw
 * shows, and a countdown without one is not counted.
 */
test.each([
  ['battle-pixel8-greninja', ['opponent: Greninja threw a charged move: none of our shields left to prompt for']],
  ['battle-pixel8-moltres-wing', []],
])('after %s, the countdown counts as a throw in %j', async (fight, threw) => {
  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture(fight), swipes: { count: 10, to: 'countdown' } },
      countdown: { frame: fixture('other-pixel8-countdown'), lasts: { ms: 3000, to: 'banner' } },
      banner: { frame: fixture('battle-banner-pixel8-greninja'), lasts: { ms: 2000, to: 'won' } },
    },
    'fight',
  );
  const report = recorder();

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons: ICONS,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
    report,
  );

  expect(report.events.filter((line) => line.includes('threw a charged move'))).toEqual(threw);
  expect(taps.filter((scene) => scene === 'countdown')).toEqual([]);

  if (threw.length > 0) {
    expect(report.events).toContain('opponent: Greninja has Hydro Cannon');
  }
});

/**
 * The switch prompt carries a countdown too, as after Moltres fainted to a Garganacl, recorded off a Pixel 8 Pro. With
 * its grey Poké Ball painted red, no faint of ours accounts for the prompt, and the run takes it for `other`, as it does
 * a dark field that matches the prompt's slate. With none of our shields left, its countdown is still no throw.
 */
test('counts no throw off the countdown on a switch prompt taken for `other`', async () => {
  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture('battle-pixel8-greninja'), swipes: { count: 10, to: 'prompt' } },
      prompt: {
        frame: painted(fixture('switch-pixel8-countdown'), [200, 60, 60], [0.045, 0.19, 0.071, 0.215]),
        lasts: { ms: 3000, to: 'won' },
      },
    },
    'fight',
  );
  const report = recorder();

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons: ICONS,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
    report,
  );

  expect(
    taps.filter((scene) => scene === 'prompt'),
    'the prompt was answered, so not taken for `other`',
  ).toEqual([]);
  expect(report.events.filter((line) => line.includes('threw a charged move'))).toEqual([]);
});

// Started mid-battle in GO Battle League, the party screen that states the league's cap never seen: every shield taken,
// even the one Charizard keeps in Training.
test('takes every shield in GO Battle League until the party screen has given the cap', async () => {
  const { phone, clock, taps } = scripted(
    {
      ...league(),
      ...charizardHit(fixture('shield-charizard-high'), true),
      result: { frame: fixture('menu-gbl-result-last'), tap: { at: [0.5, 0.935], to: 'collect' } },
      collect: { frame: fixture('menu-gbl-collect') },
    },
    'fight',
  );

  await run(phone, { mode: GBL, data: DATA, icons: ICONS, typeIcons: TYPE_ICONS, count: 1 }, clock);

  expect(taps.filter((scene) => scene === 'prompt')).toEqual(['prompt']);
});

// The same, but with the league's meta loaded: `--league ultra` gives the cap the party screen would have, so Charizard
// at 86% with one shield eats the hit as it does in Training.
test('takes the cap from the league named until the party screen gives it', async () => {
  const { phone, clock, taps } = scripted(
    {
      ...league(),
      ...charizardHit(fixture('shield-charizard-high'), true),
      result: { frame: fixture('menu-gbl-result-last'), tap: { at: [0.5, 0.935], to: 'collect' } },
      collect: { frame: fixture('menu-gbl-collect') },
    },
    'fight',
  );
  const report = recorder();
  const meta = { cup: 'all', cap: 2500, movesets: new Map() };

  await run(phone, { mode: GBL, data: DATA, icons: ICONS, typeIcons: TYPE_ICONS, meta, count: 1 }, clock, report);

  expect(taps.filter((scene) => scene === 'prompt')).toEqual([]);
  expect(report.events.filter((line) => line.includes(' shield'))).toEqual([
    'own: kept shield: Fire Blast would take ~48%, with 86% left; leaves ~38%, more than the ~20% of 10 fast moves ' +
      'before their next charged move',
  ]);
});

/**
 * A second either side of the shield prompt is handed to `keep`, each frame once, with when it was first seen: the
 * fight before it and the prompt and the frame after it, but not the lead's three seconds earlier nor a frame first
 * shown past the second.
 */
test('keeps the frames a second either side of a shield prompt', async () => {
  const scenes: Record<string, Scene> = {
    ...battleAndBack(),
    lead: { frame: fixture('battle-latias'), lasts: { ms: 3000, to: 'fight' } },
    fight: { frame: fixture('battle-charizard-magmar'), lasts: { ms: 500, to: 'prompt' } },
    prompt: { frame: fixture('shield-charizard-high'), lasts: { ms: 400, to: 'after' } },
    after: { frame: fixture('battle-charizard-magmar'), lasts: { ms: 800, to: 'later' } },
    later: { frame: fixture('battle-charizard-magmar'), lasts: { ms: 2000, to: 'won' } },
  };
  const { phone, clock } = scripted(scenes, 'lead');
  const sceneOf = (frame: Image) => Object.keys(scenes).find((name) => scenes[name]?.frame === frame);
  const kept: [string | undefined, number, string][] = [];

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons: ICONS,
      typeIcons: TYPE_ICONS,
      count: 1,
      keep: (frame, at, event) => kept.push([sceneOf(frame), at, event]),
    },
    clock,
  );

  expect(kept).toEqual([
    ['fight', 3080, 'shield'],
    ['prompt', 3630, 'shield'],
    ['after', 4040, 'shield'],
  ]);
});

/**
 * What is read of each side through a battle: its CP off the HUD, its HP off its bar, how many shields we have, and the
 * opponent's energy counted off ours.
 */
test('says each side’s CP and HP, and how many shields we have left', async () => {
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      fight: { frame: fixture('battle-one-shield'), swipes: { count: 10, to: 'prompt' } },
      prompt: { frame: fixture('shield-low'), lasts: { ms: 3000, to: 'won' } },
    },
    'fight',
  );
  const report = recorder();

  await run(
    phone,
    {
      mode: { mode: 'training', leader: 'blanche', league: 'ultra' },
      data: DATA,
      icons: ICONS,
      typeIcons: TYPE_ICONS,
      count: 1,
    },
    clock,
    report,
  );

  const percent = (hp: number | null) => (hp === null ? null : Math.round(hp * 100));
  const read = report.fights.map(({ own, opponent }) => [
    own.cp,
    percent(own.hp),
    opponent.cp,
    percent(opponent.hp),
    own.shields,
  ]);

  expect(read).toContainEqual([2495, 74, 2497, 51, 1]);
  expect(read.at(-1)).toEqual([2495, 9, 2497, 6, 1]);

  // The shield prompt is the opponent's charged move, told once however long it shows.
  expect(report.events.filter((line) => line.endsWith('threw a charged move'))).toEqual([
    `opponent: ${report.fights.at(-1)?.opponent.species ?? 'the opponent'} threw a charged move`,
  ]);

  // One frame of the fight shown throughout lands no hit, and the drop to 9% comes across the prompt, which pauses it.
  // Nothing is counted until the battle's first read is back to name the opponent.
  expect(new Set(report.fights.map(({ energy }) => energy && `${energy.energy} by ${energy.fast}`))).toEqual(
    new Set([undefined, '0 by Wing Attack']),
  );
});

test('stops, keeping its last frames, where nothing is recognised', async () => {
  const { phone, clock, taps } = scripted({ stuck: { frame: fixture('other-loss') } }, 'stuck');

  const lost = await run(
    phone,
    { mode: { mode: 'training', leader: 'blanche', league: 'ultra' }, data: DATA, icons: ICONS, typeIcons: TYPE_ICONS },
    clock,
  ).catch((error: unknown) => error);

  expect(lost).toBeInstanceOf(Lost);
  expect((lost as Lost).frames.length).toBeGreaterThan(0);
  expect(clock.now()).toBeGreaterThan(LOST_MS);
  expect(taps).toEqual([]);
});
