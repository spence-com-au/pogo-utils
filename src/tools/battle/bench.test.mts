/**
 * Our switches as a battle plays them out, against the vended game master: decided on, tapped, judged by the HUD after
 * the tap, refused by the switch timer or dropped, and the energy each leaves banked on the bench, on the pairings the
 * strategy's own tests pin. Tyranitar is threatened by Salamence, which Kyogre counters and is safe from.
 */

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { type GameData } from '../inventory/game-master.mts';
import { Bench, type Field } from './bench.mts';
import { NO_STAGE_PAIR, NO_STAGES } from './damage.mts';
import { place } from './layout.mts';
import { type Card } from './party.mts';
import { BENCH, BENCH_ANCHOR } from './play.mts';
import { nextOut } from './strategy.mts';

const DATA = JSON.parse(
  readFileSync(new URL('../inventory/fixtures/game-master.json', import.meta.url), 'utf8'),
) as GameData;

/** A stream frame's size, which the bench's cards are placed on. */
const SCREEN = { width: 360, height: 760 };

/** A party of cards whose silhouettes named `species`, and of which nothing else was read. */
const cards = (species: readonly string[]): Card[] => species.map((name) => ({ species: name, cp: null }));

/**
 * A frame of the fight against a Salamence of CP 2480, both sides whole with both shields, `party`'s slot `slot` out at
 * CP 2400 and nothing lit, but as `over` has it.
 */
function fieldOf(party: readonly string[], slot: number, over: Partial<Field> = {}): Field {
  return {
    now: 0,
    party: cards(party),
    fainted: new Set(),
    facing: {
      own: { species: party[slot] ?? null, cp: 2400 },
      opponent: { species: 'Salamence', cp: 2480 },
      cap: 2500,
    },
    hp: { own: 1, opponent: 1 },
    shields: { ours: 2, theirs: 2 },
    stages: NO_STAGE_PAIR,
    fighting: true,
    anchored: false,
    screen: SCREEN,
    slot,
    cap: 2500,
    moves: new Map(),
    lit: [],
    best: undefined,
    finish: false,
    throwing: false,
    pending: false,
    lastHit: false,
    estimate: null,
    affordable: undefined,
    seen: undefined,
    ...over,
  };
}

/** A bench and what it tells, each event after the side it is of. */
function benchOf(): { bench: Bench; events: string[] } {
  const events: string[] = [];
  const bench = new Bench(DATA, null, (line, side, why) =>
    events.push(`${side ?? 'run'}: ${line}${why ? `: ${why}` : ''}`),
  );

  return { bench, events };
}

const COUNTER = "Tyranitar is hit super effectively; Blizzard is, and nothing of Salamence's is";

test("answers the opponent's switch with a counter, tapped once the newcomer has flown in", () => {
  const { bench } = benchOf();

  bench.newcomer(1_000, true);
  bench.decide(fieldOf(['Tyranitar', 'Kyogre', 'Giratina'], 0, { now: 1_500 }));

  // The bench's cards are the slots not fainted bar the one out, so Kyogre's is the first.
  expect(bench.chosen).toEqual({
    slot: 1,
    why: COUNTER,
    at: place(BENCH[0] ?? [0, 0], BENCH_ANCHOR, SCREEN),
    strip: false,
  });
  expect(bench.flying(1_500)).toBe(true);
  expect(bench.flying(3_000)).toBe(false);
});

test('leaves a newcomer sent in after a faint unanswered', () => {
  const { bench } = benchOf();
  const lit = { moves: new Map([[0.31, 'Stone Edge']]), lit: [0.31] };

  bench.newcomer(1_000, false);
  bench.decide(fieldOf(['Tyranitar', 'Kyogre', 'Giratina'], 0, { now: 3_000, ...lit }));

  expect(bench.chosen).toBe(undefined);
});

test('gives up a switch decided on while the newcomer flies in, where a lit move comes to finish it', () => {
  const { bench } = benchOf();
  const field = fieldOf(['Tyranitar', 'Kyogre', 'Giratina'], 0);

  bench.newcomer(0, true);
  bench.decide({ ...field, now: 500 });
  expect(bench.chosen?.slot).toBe(1);

  bench.decide({ ...field, now: 1_000, finish: true });
  expect(bench.chosen).toBe(undefined);
});

// Stone Edge lit to throw, no shield of ours left and Tyranitar all but fainted: it is drawn into Salamence's shield.
test('stays in, doomed, rather than switch, and says so once', () => {
  const { bench, events } = benchOf();
  const field = fieldOf(['Tyranitar', 'Kyogre', 'Giratina'], 0, {
    hp: { own: 0.05, opponent: 1 },
    shields: { ours: 0, theirs: 1 },
    moves: new Map([[0.31, 'Stone Edge']]),
    lit: [0.31],
    best: 0.31,
  });

  bench.newcomer(0, true);
  bench.decide({ ...field, now: 3_000 });
  bench.decide({ ...field, now: 3_100 });

  expect(bench.chosen).toBe(undefined);
  expect(events).toEqual(['own: staying in against Salamence: Stone Edge drawn into a shield before Tyranitar faints']);
});

test('tries a dropped tap once more, then nothing more for `REFUSED_MS`', () => {
  const { bench, events } = benchOf();
  const party = ['Tyranitar', 'Kyogre', 'Giratina'];
  const field = fieldOf(party, 0, { moves: new Map([[0.31, 'Stone Edge']]), lit: [0.31] });
  const tyranitar = { own: 'Tyranitar', ownCp: null };

  bench.newcomer(0, true);
  bench.decide({ ...field, now: 3_000 });
  bench.tapped({ ...field, now: 3_000 });

  expect(bench.switching).toBe(true);
  expect(bench.judge(tyranitar, 4_000, field.party, 4_000), 'read too soon').toEqual({ kind: 'early', due: 5_000 });
  expect(bench.judge(tyranitar, 5_000, field.party, 5_500)).toEqual({ kind: 'refused', from: 0, stages: NO_STAGES });

  // Answered afresh, as though never tapped.
  bench.decide({ ...field, now: 6_000 });
  expect(bench.chosen?.slot).toBe(1);

  bench.tapped({ ...field, now: 6_000 });
  expect(bench.judge(tyranitar, 8_000, field.party, 8_000)?.kind).toBe('refused');

  // Not answered a third time, nor Stone Edge banked by a refuge, until 10s on.
  bench.decide({ ...field, now: 17_999 });
  expect(bench.chosen).toBe(undefined);

  bench.decide({ ...field, now: 18_000 });
  expect(bench.chosen?.why).toBe(
    "Tyranitar is hit super effectively and banks its energy; Kyogre is safe from Salamence's moves",
  );

  const switching = `own: switching to Kyogre against Salamence, banking Stone Edge: ${COUNTER}`;
  const dropped = 'own: Kyogre not sent in: taken as dropped, no switch of ours in the last 45s';

  expect(events).toEqual([switching, dropped, switching, dropped]);
});

// Kyogre went in, fainted, and Tyranitar was sent back in against Salamence switched in again, the second Kyogre
// countering it 9s after the first went in.
test('takes a tap refused within `TIMER_MS` of a switch that went through as the switch timer’s', () => {
  const { bench, events } = benchOf();
  const party = ['Tyranitar', 'Kyogre', 'Kyogre'];
  const field = fieldOf(party, 0);

  bench.newcomer(0, true);
  bench.decide({ ...field, now: 3_000 });
  bench.tapped({ ...field, now: 3_000 });
  expect(bench.judge({ own: 'Kyogre', ownCp: null }, 5_000, field.party, 5_000)).toEqual({ kind: 'took' });

  bench.sentIn(0);
  bench.newcomer(10_000, true);

  const after = { ...field, fainted: new Set([1]), now: 12_000 };

  bench.decide(after);
  expect(bench.chosen?.slot).toBe(2);

  bench.tapped(after);
  expect(bench.judge({ own: 'Tyranitar', ownCp: null }, 14_000, field.party, 14_000)?.kind).toBe('refused');
  expect(events.at(-1)).toBe('own: Kyogre not sent in: the switch timer is running');
});

/** Giratina out against Salamence, Dragon Pulse lit, switched to Kyogre and banking Dragon Pulse on the bench. */
function giratinaBanked() {
  const { bench, events } = benchOf();
  const party = ['Giratina', 'Kyogre', 'Tyranitar'];
  const field = fieldOf(party, 0, { moves: new Map([[0.31, 'Dragon Pulse']]), lit: [0.31] });

  bench.newcomer(0, true);
  bench.decide({ ...field, now: 3_000 });
  expect(bench.chosen?.slot).toBe(1);
  bench.tapped({ ...field, now: 3_000 });

  return { bench, events, party };
}

/** Salamence all but fainted with no shield left: Dragon Pulse finishes it. */
const SALAMENCE_LOW: Partial<Field> = { hp: { own: 1, opponent: 0.05 }, shields: { ours: 2, theirs: 0 } };

test('sends in after a faint the slot whose banked energy finishes the opponent', () => {
  const { bench, party } = giratinaBanked();

  expect(bench.judge({ own: 'Kyogre', ownCp: null }, 5_000, cards(party), 5_000)).toEqual({ kind: 'took' });
  expect(bench.next(fieldOf(party, 1, SALAMENCE_LOW), new Set([1]))).toEqual({
    slot: 0,
    why: 'its banked Dragon Pulse finishes Salamence',
  });
});

// Which of the two fainted cannot be told, so Giratina is not trusted to have Dragon Pulse banked.
test('keeps nothing banked by a switch a faint overtakes', () => {
  const { bench, party } = giratinaBanked();

  bench.fainted();

  expect(bench.switching).toBe(false);
  expect(bench.next(fieldOf(party, 1, SALAMENCE_LOW), new Set([1]))).toEqual(
    nextOut(DATA, cards(party), new Set([1]), { species: 'Salamence' }, null),
  );
});

// Kyogre's Blizzard would finish Salamence but for its last shield, which Giratina's banked Dragon Pulse draws.
test('draws a shield with energy banked on the bench once the switch timer allows', () => {
  const { bench, party } = giratinaBanked();
  const field = fieldOf(party, 1, {
    hp: { own: 1, opponent: 0.05 },
    shields: { ours: 2, theirs: 1 },
    moves: new Map([[0.31, 'Blizzard']]),
    lit: [0.31],
  });

  expect(bench.judge({ own: 'Kyogre', ownCp: null }, 5_000, field.party, 5_000)).toEqual({ kind: 'took' });

  bench.decide({ ...field, now: 47_999 });
  expect(bench.chosen, 'the switch timer from Kyogre going in').toBe(undefined);

  bench.decide({ ...field, now: 48_000 });
  expect(bench.chosen).toMatchObject({ slot: 0, strip: true });
  expect(bench.chosen?.why).toMatch(/^Giratina has Dragon Pulse banked to draw Salamence's shield; Blizzard /);
});
