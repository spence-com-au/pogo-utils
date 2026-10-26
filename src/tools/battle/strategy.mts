/**
 * Which charged move to throw: the one worth the most, as power × STAB × type effectiveness, adjusted for the stat stages
 * it may move. Attack, defense, level and the trainer-battle bonus are the same for both of one Pokémon's moves against
 * one opponent, so they cancel out of the comparison and nothing here needs a stat.
 *
 * Whatever is not known counts as neutral rather than holding anything up: an opponent whose name was not read is hit
 * for 1×, and a Pokémon of ours whose species is not known gets no STAB. A name its forms give different types — a
 * Galarian Moltres is Dark and Flying where a Kantonian one is Fire and Flying — is the form its type icons show, and
 * counts as whichever of them a move does worst against where the icons were not read.
 *
 * And when to shield, which the prompt does not say: it never names the move coming, so a shield is spent unless every
 * charged move the opponent's species can have is known to be no better than neutral against ours. Which moves it can
 * have is narrowed, in a league PvPoke ranks, to those its players run.
 */

import { type Form, type GameData } from '../inventory/game-master.mts';
import { type Meta, type Moveset } from './meta.mts';
import { BUTTON_XS } from './recognise.mts';

/** What a move sharing a type with the Pokémon using it multiplies its damage by. */
export const STAB = 1.2;

/**
 * The charged moves only a shadow (Frustration) or a purified (Return) Pokémon holds, which every species with a shadow
 * form lists. By name, as `GameData` keys every move: the vended copy keeps no template ids.
 */
export const SHADOW_AND_PURIFIED = new Set(['Frustration', 'Return']);

/** The types of one form, the one or two of them. */
export type Typing = readonly string[];

/** A Pokémon as the HUD shows it: its species where named, and its types where the icons above its panel were read. */
export interface Shown {
  species: string | null;
  types?: Typing | null;
}

/**
 * Every form `shown` could be: those of its species with the types shown, or every one of its species where the types
 * were not read or no form has them, as a misread or a species read wrong leaves them.
 */
export function formsOf(data: GameData, { species, types }: Shown): Form[] {
  const forms = data.forms.filter((form) => form.species === species);
  const shown = forms.filter(
    (form) => types && form.types.length === types.length && form.types.every((type) => types.includes(type)),
  );

  return shown.length > 0 ? shown : forms;
}

/** Every typing `shown`'s forms have, one where they agree, and none where nothing is called that. */
export function typesOf(data: GameData, shown: Shown): readonly Typing[] {
  const forms = formsOf(data, shown).filter((form) => !form.costume);

  return [...new Set(forms.map((form) => [...form.types].sort().join('/')))].map((types) => types.split('/'));
}

/**
 * How hard a move hits, relative to the other moves of the same Pokémon against the same opponent: against the typing
 * it does worst against, either side having several. No typing at all is neutral, without STAB.
 */
export function damage(data: GameData, move: string, own: readonly Typing[], opponent: readonly Typing[]): number {
  const combat = data.combat[move];

  if (!combat) {
    return 0;
  }

  const stab = Math.min(...(own.length > 0 ? own : [[]]).map((types) => (types.includes(combat.type) ? STAB : 1)));
  const worst = Math.min(
    ...(opponent.length > 0 ? opponent : [[]]).map((types) => effectiveness(data, combat.type, types)),
  );

  return combat.power * stab * worst;
}

/**
 * What a move's damage is worth once the stat stages it may move are counted: each stage priced as if it touched one
 * more hit the size of this one, by the share that hit grows or shrinks in our favour, and weighted by the chance the
 * stages move at all. So Ancient Power's tenth of a chance at +1 attack and +1 defense makes 60 worth 62.7, and Close
 * Combat's certain −2 to its user's defense, half again on the next hit taken, makes 100 worth 50.
 *
 * On our `lastHit`, the stages it moves on ours count for nothing either way: there is no next hit for Close Combat's
 * defense to cost, nor a next throw for Ancient Power's attack to help. Those it moves on theirs still count, lasting
 * on the opponent into whichever of ours goes in next.
 */
export function worth(
  data: GameData,
  move: string,
  own: readonly Typing[],
  opponent: readonly Typing[],
  { lastHit = false } = {},
): number {
  const hit = damage(data, move, own, opponent);
  const buffs = data.combat[move]?.buffs;

  if (!buffs) {
    return hit;
  }

  const ours = lastHit ? 0 : stage(buffs.ownAttack) - 1;
  const taken = lastHit ? 0 : 1 - 1 / stage(buffs.ownDefense);
  const dealt = 1 / stage(buffs.theirDefense) - 1;
  const theirs = 1 - stage(buffs.theirAttack);

  return hit * (1 + buffs.chance * (ours + taken + dealt + theirs));
}

/** What `stages` up or down multiply an attack or defense stat by in a trainer battle: ×1.25 for +1, ×0.8 for −1. */
export function stage(stages = 0): number {
  return stages >= 0 ? (4 + stages) / 4 : 4 / (4 - stages);
}

/** What a move of `type` multiplies its damage by against a Pokémon of the `defender`'s types. */
export function effectiveness(data: GameData, type: string, defender: readonly string[]): number {
  return defender.reduce((product, against) => product * (data.effectiveness[type]?.[against] ?? 1), 1);
}

/**
 * The charged moves an opponent's form is allowed for having. Given its species' moveset out of PvPoke's meta, those of
 * its pool the meta finds plausible, Return among them where players run it. Without one — in Training, or for a
 * species or a league PvPoke does not rank — every one of its pool bar Frustration and Return, which only a shadow or
 * a purified one holds. A form holding none of the plausible moves, as one whose builds PvPoke never ranks can, is
 * allowed for the same as having none.
 */
export function chargedOf(form: Form, moveset?: Moveset): string[] {
  const pool = form.moves.filter((move) => !move.fast).map((move) => move.name);
  const plausible = moveset ? pool.filter((name) => moveset.chargedMoves.includes(name)) : [];

  return plausible.length > 0 ? plausible : pool.filter((name) => !SHADOW_AND_PURIFIED.has(name));
}

/** Every charged move any form of a species can hold, by name. */
function chargedMoves(data: GameData, species: string): Set<string> {
  const forms = data.forms.filter((form) => form.species === species);

  return new Set(forms.flatMap((form) => form.moves.filter((move) => !move.fast).map((move) => move.name)));
}

/**
 * Which slot of the party is out: `sent`, the slot last sent in, or before any faint the lead, a battle opening with
 * it. Passed over for the next not fainted, in party order, where its species cannot hold every charged move read under
 * the buttons, which a misread card would show; a card that was not read cannot be checked, and stands. Undefined where
 * no slot is left that fits.
 */
export function activeOf(
  data: GameData,
  party: readonly (string | null)[],
  fainted: ReadonlySet<number>,
  moves: Iterable<string>,
  sent = 0,
): number | undefined {
  const read = [...moves];

  const fits = (slot: number) => {
    const species = party[slot];

    return (
      species !== undefined &&
      !fainted.has(slot) &&
      (species === null || read.every((move) => chargedMoves(data, species).has(move)))
    );
  };

  return [sent, ...party.keys()].find(fits);
}

/**
 * Which slot to send in after a faint, of those not fainted, and why it over the next best: first one whose energy
 * banked on the bench finishes the opponent the moment it lands, by `finishing`'s move for it, then one the opponent
 * cannot hit super effectively, then the one with the hardest hit on it, then the first. A banked finish comes before
 * safety, the opponent gone before it can land what we would be unsafe from: live, a Galarian Moltres at a tenth of its
 * HP went back in with Fly banked and finished a Buzzwole before it could fast-move again. Hardest out of every charged
 * move its species can hold, which of them it has being shown only once it is out, bar Frustration and Return:
 * Return's 130 would otherwise tie every species that has a shadow form, few of ours being purified. A card that was
 * not read is neither safe nor known to hit, so it goes in only where nothing named is left, or where it is first and
 * nothing named is safe or hits at all.
 */
export function nextOut(
  data: GameData,
  party: readonly (string | null)[],
  fainted: ReadonlySet<number>,
  opponent: Shown,
  meta?: Meta | null,
  finishing: ReadonlyMap<number, string> = new Map(),
): { slot: number; why: string } | undefined {
  const scored = party.flatMap((species, slot) =>
    fainted.has(slot)
      ? []
      : [
          {
            slot,
            finishes: finishing.get(slot),
            safe: species !== null && !shouldShield(data, { species }, opponent, meta),
            ...hardest(data, species, opponent),
          },
        ],
  );

  scored.sort(
    (a, b) =>
      Number(b.finishes !== undefined) - Number(a.finishes !== undefined) ||
      Number(b.safe) - Number(a.safe) ||
      b.hardest - a.hardest ||
      a.slot - b.slot,
  );

  const [best, next] = scored;

  if (!best) {
    return undefined;
  }

  // What set it before the next best, which the order of the sort says.
  const safety = `safe from ${opponent.species ?? 'the opponent'}'s moves`;
  const why = !next
    ? 'the last left'
    : best.finishes !== undefined && next.finishes === undefined
      ? `its banked ${best.finishes} finishes ${opponent.species ?? 'the opponent'}`
      : best.safe !== next.safe
        ? `the only one ${safety}`
        : best.hardest !== next.hardest
          ? `${best.safe ? `${safety}, and` : `none ${safety};`} hits hardest (${best.move})`
          : 'first card, nothing to choose between them';

  return { slot: best.slot, why };
}

/**
 * The hardest hit any charged move a species can hold lands on `opponent`, bar Frustration and Return, as `nextOut`
 * ranks by; nothing for a species not read.
 */
function hardest(
  data: GameData,
  species: string | null,
  opponent: Shown,
): { hardest: number; move: string | undefined } {
  const own = typesOf(data, { species });
  const types = typesOf(data, opponent);
  const moves = species === null ? [] : [...chargedMoves(data, species)].filter((m) => !SHADOW_AND_PURIFIED.has(m));
  let best = { hardest: 0, move: undefined as string | undefined };

  for (const move of moves) {
    const hit = damage(data, move, own, types);

    if (hit > best.hardest) {
      best = { hardest: hit, move };
    }
  }

  return best;
}

/**
 * Which slot to switch to, of the bench, once the opponent has switched in a Pokémon that threatens ours: only where one
 * benched counters it outright, safe from every charged move it is allowed for and holding one that hits it super
 * effectively, against whichever typing its forms have that takes it worst. The hardest-hitting of those, and between
 * equals the first card. Undefined where ours is not threatened, as by `shouldShield`'s rule, or where either species
 * is not known: a switch spends the switch timer, so it is made only where it is clearly better.
 *
 * Super effective out of every move its species can hold, as `nextOut` judges, which of them it has being shown only
 * once it is out.
 */
export function counterOf(
  data: GameData,
  party: readonly (string | null)[],
  out: number,
  own: Shown,
  fainted: ReadonlySet<number>,
  opponent: Shown,
  meta?: Meta | null,
): { slot: number; why: string } | undefined {
  if (own.species === null || opponent.species === null || !shouldShield(data, own, opponent, meta)) {
    return undefined;
  }

  const types = typesOf(data, opponent);
  const counters = party.flatMap((species, slot) => {
    if (species === null || slot === out || fainted.has(slot) || shouldShield(data, { species }, opponent, meta)) {
      return [];
    }

    const moves = [...chargedMoves(data, species)].filter((m) => !SHADOW_AND_PURIFIED.has(m));
    const beats = moves.find((name) => {
      const type = data.combat[name]?.type;

      return type !== undefined && types.every((typing) => effectiveness(data, type, typing) > 1);
    });

    return beats === undefined ? [] : [{ slot, beats, ...hardest(data, species, opponent) }];
  });

  const [best] = counters.sort((a, b) => b.hardest - a.hardest || a.slot - b.slot);

  return (
    best && {
      slot: best.slot,
      why: `${own.species} is hit super effectively; ${best.beats} is, and nothing of ${opponent.species}'s is`,
    }
  );
}

/** A benched slot to switch to, and why. */
export interface Switch {
  slot: number;
  why: string;
}

/**
 * Which slot to switch to, of the bench, where no counter is but ours, threatened by the opponent just switched in, has
 * a charged move ready: one safe from every charged move the opponent is allowed for, so that ours keeps its energy on
 * the bench rather than spend it into a shield or faint with it. The hardest-hitting of those, and between equals the
 * first card. Undefined where ours is not threatened, as by `shouldShield`'s rule, or where either species is not known.
 *
 * Live, a Galarian Moltres facing a Granbull switched in, Fly ready and nothing benched hitting Granbull super
 * effectively, gave way to a Snorlax, which drew both its shields; Moltres came back to finish a Milotic with the energy
 * it had kept. Whether ours has a move ready is the caller's to say: what is lit is read off the frame.
 */
export function refugeOf(
  data: GameData,
  party: readonly (string | null)[],
  out: number,
  own: Shown,
  fainted: ReadonlySet<number>,
  opponent: Shown,
  meta?: Meta | null,
): Switch | undefined {
  if (own.species === null || opponent.species === null || !shouldShield(data, own, opponent, meta)) {
    return undefined;
  }

  const [best] = party
    .flatMap((species, slot) =>
      species === null || slot === out || fainted.has(slot) || shouldShield(data, { species }, opponent, meta)
        ? []
        : [{ slot, species, ...hardest(data, species, opponent) }],
    )
    .sort((a, b) => b.hardest - a.hardest || a.slot - b.slot);

  return (
    best && {
      slot: best.slot,
      why: `${own.species} is hit super effectively and banks its energy; ${best.species} is safe from ${opponent.species}'s moves`,
    }
  );
}

/**
 * Which slot to switch to, of the bench, to draw the shield the opponent would take against a finish ours has ready:
 * one with energy banked, which throws as it lands, by the moves `banked` says were ready as each left the field. One
 * the opponent cannot hit super effectively first, then the one with the hardest hit on it, then the first card.
 * Undefined where none has energy banked, or where the opponent's species is not known. Ours keeps its finish on the
 * bench, to throw once the shields are gone, sent back in by `nextOut` after the one sent faints.
 *
 * Live, a Melmetal with Dynamic Punch ready to finish a shielded Hisuian Samurott gave way to a Galarian Moltres, whose
 * two banked Fly drew both shields; Melmetal came back in after Moltres fainted and finished Samurott.
 */
export function stripperOf(
  data: GameData,
  party: readonly (string | null)[],
  out: number,
  fainted: ReadonlySet<number>,
  banked: ReadonlyMap<number, readonly string[]>,
  opponent: Shown,
  meta?: Meta | null,
): Switch | undefined {
  if (opponent.species === null) {
    return undefined;
  }

  const [best] = [...banked]
    .flatMap(([slot, moves]) => {
      const species = party[slot];

      return species === undefined || slot === out || fainted.has(slot) || moves.length === 0
        ? []
        : [
            {
              slot,
              moves,
              safe: species !== null && !shouldShield(data, { species }, opponent, meta),
              ...hardest(data, species, opponent),
            },
          ];
    })
    .sort((a, b) => Number(b.safe) - Number(a.safe) || b.hardest - a.hardest || a.slot - b.slot);

  return (
    best && {
      slot: best.slot,
      why: `${party[best.slot] ?? '?'} has ${best.moves.join(' and ')} banked to draw ${opponent.species}'s shield`,
    }
  );
}

/**
 * Whether to take a shield offered against `opponent` while `own` is out: unless both species are known and none of
 * the opponent's charged moves would be super effective against any typing ours could have. Every move its forms are
 * allowed for by `chargedOf`, since which two this one has is never shown: legacy and elite ones among them, or in a
 * league PvPoke ranks, those its players run.
 */
export function shouldShield(data: GameData, own: Shown, opponent: Shown, meta?: Meta | null): boolean {
  const typings = typesOf(data, own);

  if (typings.length === 0 || opponent.species === null) {
    return true;
  }

  const moveset = meta?.movesets.get(opponent.species);
  const moves = [...new Set(formsOf(data, opponent).flatMap((form) => chargedOf(form, moveset)))].flatMap(
    (name) => data.combat[name] ?? [],
  );

  return moves.length === 0 || moves.some((move) => typings.some((types) => effectiveness(data, move.type, types) > 1));
}

/**
 * How much cheaper than the move worth the most a bait must be to be thrown in its place. A bait saves only the energy
 * between the two, and ten is a fast move or two — Scizor's Bullet Punch gains 7 — where the shield it draws may never
 * come. Togekiss baited a Scizor with Ancient Power, 45 energy, rather than throw Flamethrower, 55, which hits Scizor
 * 2.56×: Scizor shielded the one Ancient Power, and Togekiss fainted seven seconds later without having thrown again.
 */
export const BAIT_SAVES = 10;

/**
 * The button to throw, by its x, and whether it is thrown as a bait. `why` says why not, where a bait was asked for and
 * the bait was not thrown, its saving being too small for it.
 */
export interface Pick {
  x: number;
  bait: boolean;
  why?: string;
}

/** A button's move as `bestButton` weighs it: what it costs, as a positive energy, and what it is worth. */
interface Weighed {
  x: number;
  move: string;
  cost: number;
  worth: number;
}

const weigh = (
  data: GameData,
  x: number,
  move: string,
  own: readonly Typing[],
  opponent: readonly Typing[],
  lastHit: boolean,
): Weighed => ({
  x,
  move,
  cost: -(data.combat[move]?.energy ?? 0),
  worth: worth(data, move, own, opponent, { lastHit }),
});

/**
 * Which button to throw, given the move read under each button: the one worth the most, or undefined where a button of
 * the pair has no move read under it yet and so could be either. While `bait`, the cheapest instead, to draw a shield
 * the strongest would otherwise be thrown into, and the one worth more of two that cost the same; but only where it
 * costs more than `BAIT_SAVES` less than the one worth the most, which is thrown instead as if there were no shields to
 * bait. Worth as `worth` prices it on our `lastHit` or otherwise.
 */
export function bestButton(
  data: GameData,
  moves: ReadonlyMap<number, string>,
  own: readonly Typing[],
  opponent: readonly Typing[],
  { bait = false, lastHit = false } = {},
): Pick | undefined {
  const [left, centre, right] = BUTTON_XS;
  const buttons = moves.has(left) || moves.has(right) ? [left, right] : [centre];
  let strongest: Weighed | undefined;
  let cheapest: Weighed | undefined;

  for (const x of buttons) {
    const move = moves.get(x);

    if (move === undefined) {
      return undefined;
    }

    const hit = weigh(data, x, move, own, opponent, lastHit);

    if (!strongest || hit.worth > strongest.worth) {
      strongest = hit;
    }

    if (!cheapest || hit.cost < cheapest.cost || (hit.cost === cheapest.cost && hit.worth > cheapest.worth)) {
      cheapest = hit;
    }
  }

  if (!strongest || !cheapest || !bait || cheapest === strongest) {
    return strongest && { x: strongest.x, bait };
  }

  const saves = strongest.cost - cheapest.cost;

  return saves > BAIT_SAVES
    ? { x: cheapest.x, bait }
    : {
        x: strongest.x,
        bait: false,
        why: `not baiting: ${cheapest.move} costs only ${saves} less than ${strongest.move}`,
      };
}

/**
 * Which of the `lit` buttons is worth the most to throw now, by its x, rather than hold for the one chosen: of those
 * with a move read under them, a lit button whose move is not known having nothing to weigh. Undefined where none is.
 * Worth as `worth` prices it on our `lastHit` or otherwise, and with no bait: a throw that may be our last is worth what
 * it hits for.
 */
export function bestLit(
  data: GameData,
  moves: ReadonlyMap<number, string>,
  lit: Iterable<number>,
  own: readonly Typing[],
  opponent: readonly Typing[],
  { lastHit = false } = {},
): number | undefined {
  let best: Weighed | undefined;

  for (const x of lit) {
    const move = moves.get(x);
    const hit = move === undefined ? undefined : weigh(data, x, move, own, opponent, lastHit);

    if (hit && (!best || hit.worth > best.worth)) {
      best = hit;
    }
  }

  return best?.x;
}
