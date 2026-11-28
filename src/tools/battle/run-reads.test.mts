/**
 * Reading the battle through the opponent's charged move, a flash or a countdown, and dropping reads a switch or the
 * battle's end leaves stale.
 */

import { type GameData } from '../../core/game-master.mts';
import { type Point } from './layout.mts';
import {
  battleAndBack,
  DATA,
  fightThen,
  fixture,
  ICONS,
  minigameNoneFainted,
  OCR_MS,
  painted,
  play,
  recorder,
  type Scene,
  scripted,
  ULTRA,
  unnamed,
} from './node/test-run.mts';
import { expect, test } from 'vitest';

/**
 * The opponent throws, and its move plays out after the shield prompt, the HUD up and none of our buttons drawn: nothing
 * is touched, and our energy is counted no further. In a kept run, swipes landed through Garchomp's Sand Tomb and the
 * `Get Ready!` of ours after it, and our energy was counted from 52 to 91 through them.
 */
test('touches nothing and counts none of our energy through the opponent’s charged move', async () => {
  const { strokes, told } = await fightThen({
    next: {
      frame: fixture('shield-pixel8'),
      tap: { at: [0.5, 0.83], to: 'playing' },
      lasts: { ms: 1500, to: 'playing' },
    },
    playing: { frame: unnamed(), lasts: { ms: 3000, to: 'won' } },
  });
  const fought = told.filter(({ screen }) => screen === 'battle').at(-1)?.energy;

  expect(fought).toBeGreaterThan(0);
  expect(strokes.filter(({ scene }) => scene === 'playing')).toEqual([]);
  expect(new Set(told.filter(({ screen }) => screen === 'playing').map(({ energy }) => energy))).toEqual(
    new Set([fought]),
  );
});

/**
 * Straight from the fight, a frame of the HUD with none of our charged moves' names drawn, as a fast move's flash over
 * the foot of the screen leaves: Lugia's hid them for up to 0.46s at a time in a kept run, the fight going on beneath.
 * It is swiped as the fight for `FLASH_MS`, and no longer.
 */
test('fights on through a flash that hides our buttons’ names for a moment', async () => {
  const { strokes } = await fightThen({ next: { frame: unnamed(), lasts: { ms: 3000, to: 'won' } } });
  const flash = strokes.filter(({ scene }) => scene === 'next').map(({ at }) => at);

  expect(flash.length).toBeGreaterThan(0);
  expect(Math.max(...flash) - Math.min(...flash)).toBeLessThan(600);
});

/**
 * The game master with Entei's base attack 3 higher, which leaves a rank-1 Entei at CP 4163 built as before but for
 * its attack, ~214 to the ~212 of a rank-1 Kyogre at CP 3813: Entei then wins CMP, where it loses it to its ~211.
 */
const ENTEI_STRONGER: GameData = {
  ...DATA,
  forms: DATA.forms.map((form) => (form.species === 'Entei' ? { ...form, attack: form.attack + 3 } : form)),
};

/**
 * Kyogre, CP 3813, against Entei, CP 4163, in Master League, both sides' shields painted spent and Hydro Pump's button
 * painted unlit: Hydro Pump is held for, worth more per energy into Entei, with Avalanche lit. Giratina's icon stands
 * for Kyogre on the party screen, as `mirror`'s does for Entei, so that the card the moves under the buttons fit names
 * ours. Our bar, repainted, loses 4 points to each of Entei's fast moves, counted as Fire Spin's 10 energy, 200ms apart
 * once the battle's first read has named it, from 60%. Overheat, 55 energy, would take ~42% of a rank-1 Kyogre, fainting
 * us from 46% down; Scorching Sands, 50, ~35%, from 38%. After 4 hits, at 44%, 40 energy and one more for the count
 * afford only Scorching Sands, and Overheat only with one more again; after 5, at 40%, Overheat. Losing CMP, Avalanche
 * goes after 4; winning it, after 5, the throw it saved told after 4.
 */
test.each([
  [
    'loses',
    ENTEI_STRONGER,
    'hit4',
    [
      'own: threw Avalanche: Entei wins CMP (atk ~214 v ~212), Overheat affordable after one more Fire Spin; not holding for Hydro Pump',
    ],
  ],
  [
    'wins',
    DATA,
    'hit5',
    [
      'own: not throwing Avalanche yet: Kyogre wins CMP (atk ~212 v ~211), Overheat affordable after one more Fire Spin',
      'own: threw Avalanche: Overheat would faint us, 60 energy affords it; not holding for Hydro Pump',
    ],
  ],
])('where ours %s CMP, a fainting move is feared a fast move sooner', async (_, data, tapped, said) => {
  const icons = ICONS.map((icon) => ({ ...icon, species: icon.species === 'Giratina' ? 'Kyogre' : icon.species }));
  const spent = painted(
    fixture('charged-two-both'),
    [111, 81, 118],
    [0.23, 0.2027, 0.242, 0.2153],
    [0.7, 0.195, 0.78, 0.222],
  );
  const unlit = painted(spent, [107, 105, 112], [68 / 360, 635 / 360, 152 / 360, 676 / 360]);
  const ours = (px: number) =>
    painted(
      painted(unlit, [10, 45, 80], [22 / 360, 201 / 360, 122 / 360, 207 / 360]),
      [25, 255, 190],
      [22 / 360, 201 / 360, (22 + px) / 360, 207 / 360],
    );
  const names = Array.from({ length: 8 }, (_, i) => (i === 0 ? 'fight' : `hit${i}`));
  const hits = names.map((name, i): [string, Scene] => [
    name,
    {
      frame: ours(60 - 4 * i),
      tap: { at: [0.69, 0.889], to: 'minigame' },
      lasts: { ms: i === 0 ? 400 : 200, to: names[i + 1] ?? 'won' },
    },
  ]);
  const { phone, clock, taps } = scripted(
    { ...battleAndBack(), minigame: minigameNoneFainted(), ...Object.fromEntries(hits) },
    'party',
  );
  const report = recorder();

  await play(
    phone,
    { mode: { mode: 'training', leader: 'blanche', league: 'master' }, data, icons, count: 1 },
    clock,
    report,
  );

  expect(taps.filter((scene) => names.includes(scene))).toEqual([tapped]);
  expect(report.events.filter((line) => /^own: (threw|not throwing)/.test(line))).toEqual(said);
});

/**
 * The countdown before the fight drawn over the opponent's full bar, its 2 across the middle and then its 1 over the
 * left end, which read the bar 22% and then 78%: a drop for our hits and a rise for a newcomer of theirs. Neither is
 * read, and the opponent's HP is first decided on off the fight's own bar.
 */
test('reads none of the opponent’s bar through the countdown drawn over it', async () => {
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      two: { frame: fixture('battle-countdown-two'), lasts: { ms: 1000, to: 'one' } },
      one: { frame: fixture('battle-countdown-one'), lasts: { ms: 1000, to: 'fight' } },
      fight: { frame: fixture('battle-deoxys'), swipes: { count: 10, to: 'won' } },
    },
    'two',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, count: 1 }, clock, report);

  expect(new Set(report.fights.map(({ opponent }) => opponent.hp && Math.round(opponent.hp * 100)))).toEqual(
    new Set([null, 99]),
  );
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

  await play(phone, { mode: ULTRA, count: 1 }, clock, report);

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

  await play(phone, { mode: ULTRA, count: 1 }, clock, report);

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

  await play(phone, { mode: ULTRA, count: 2 }, clock, report);

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

  await play(phone, { mode: ULTRA, count: 1 }, clock, report);

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

  await play(phone, { mode: ULTRA, count: 1 }, clock, report);

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

  await play(phone, { mode: ULTRA, icons, typeIcons: {}, count: 1 }, clock, report);

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

  await play(phone, { mode: ULTRA, typeIcons: {}, count: 1 }, clock, report);

  expect(
    report.events.filter((line) => line.startsWith('own: Zeraora') || line.startsWith('own: switching to Zeraora')),
  ).toEqual(told);
});
