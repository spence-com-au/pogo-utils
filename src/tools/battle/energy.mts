/**
 * How much energy the opponent has, counted off our own HP bar: each fast move of theirs that lands takes a step off it,
 * and gains them its energy. The HUD shows neither their energy nor their fast move, so both come from the steps.
 *
 * How many hits a stretch of the fight held is the HP it took ÷ what one hit takes, and what one hit takes is measured
 * rather than modelled where it can be: the median of the clean steps, a drop between two readings too close together
 * for two hits to fall between them. That needs no IVs and no shadow bonus, which the damage model can only guess.
 * The model says which fast move a step of that size is, among those the opponent's species is allowed for, and so
 * how much energy each one gains; until a clean step has been seen it stands in for the step too, at the smallest hit
 * any of its builds would land, which counts the most hits and so errs towards more energy rather than less.
 *
 * Counted per opponent Pokémon, whose energy is kept while it is switched out, and per stretch the same two Pokémon
 * face each other, a step being a fraction of whichever bar of ours it came off. HP lost across anything else — a
 * charged move, a prompt, the minigame, a banner over the HUD — is not counted, the drop across it not being a fast
 * move's. A hit landing in such a gap goes uncounted with it, which the slack the caller allows covers.
 */

import { type GameData } from '../inventory/game-master.mts';
import { buildsOf, capped, hit, MOVES_HELD, type Side } from './damage.mts';
import { type Meta } from './meta.mts';
import { chargedOf, formsOf, type Shown } from './strategy.mts';

/** As much energy as a Pokémon can hold. */
export const FULL = 100;

/**
 * How close together two readings of our bar must be for the drop between them to be one hit, in milliseconds: a fast
 * move takes at least a turn of 500ms, so two cannot both land in less.
 */
const CLEAN_MS = 500;

/**
 * The least drop of our bar that counts as a hit rather than a misread, as a fraction of it: a pixel of the bar's 100
 * at 360 wide. A 1-power Lock-On can take less, and goes uncounted below it.
 */
const LEAST = 0.01;

/** The two Pokémon facing each other, and the league's cap their CPs are read against. */
export interface Matchup {
  own: Side;
  opponent: Side;
  cap: number | null;
}

/** A stretch of the fight between the same two Pokémon, as far as their energy is counted off it. */
interface Stretch {
  matchup: Matchup;

  /** Our HP at its lowest yet, and when it was read: the reading the next drop is measured from. */
  low: number | null;
  at: number;

  /** How much of our bar its fast moves have taken since their energy was last settled, by a throw. */
  lost: number;

  /** Every clean step seen, which outlive a throw: they say what one hit takes. */
  steps: number[];
}

/** One opponent Pokémon's count. */
interface Tally {
  stretches: Stretch[];

  /** Its energy when it last threw, what was left after the throw. */
  carried: number;

  /** What it had when it last threw, until the banner names the move and so what the throw cost. */
  had?: number;
}

export interface Estimate {
  /** The energy counted, from 0 to `FULL`. */
  energy: number;

  /** The fast move it is counted by, and what each one gains. */
  fast: string;
  gain: number;
}

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[sorted.length >> 1] ?? 0;
};

const keyOf = ({ own, opponent }: Matchup) =>
  [own, opponent].map(({ species, cp, types }) => `${species}|${cp}|${types?.join('/')}`).join('|');

export class Energy {
  readonly #data: GameData;
  readonly #meta: Meta | null | undefined;
  readonly #tallies = new Map<string, Tally>();
  #stretch: Stretch | undefined;

  constructor(data: GameData, meta?: Meta | null) {
    this.#data = data;
    this.#meta = meta;
  }

  /**
   * Our bar read at `at` milliseconds, outside anything that pauses the fight. A new matchup — either side sent in, or
   * a species or CP read since — starts a stretch of its own, the drop across the change not being a hit.
   */
  read(at: number, hp: number, matchup: Matchup): void {
    const species = matchup.opponent.species;

    if (species === null) {
      this.#stretch = undefined;
      return;
    }

    const tally = this.#tallyOf(species);

    if (!this.#stretch || keyOf(this.#stretch.matchup) !== keyOf(matchup)) {
      this.#stretch = { matchup, low: null, at, lost: 0, steps: [] };
      tally.stretches.push(this.#stretch);
    }

    const stretch = this.#stretch;

    if (stretch.low === null) {
      stretch.low = hp;
      stretch.at = at;
      return;
    }

    const drop = stretch.low - hp;

    if (drop >= LEAST) {
      stretch.lost += drop;

      if (at - stretch.at < CLEAN_MS) {
        stretch.steps.push(drop);
      }

      stretch.low = hp;
    }

    // Read again without a drop, the next one is measured from this reading's time: a bar read every frame has a step
    // land between two readings a frame apart.
    if (drop > -LEAST) {
      stretch.at = at;
    }
  }

  /** Anything the fight pauses for, or our bar unread across: the next reading is measured from afresh. */
  pause(): void {
    if (this.#stretch) {
      this.#stretch.low = null;
    }
  }

  /**
   * The opponent threw a charged move, which until the banner names it with `named` is the cheapest it is allowed for —
   * of the two `seen`, once both have been — the cheapest leaving it the most energy, the safe side to err on. What it
   * had is settled there, at no more than `FULL`, the fast moves it spent at full energy gaining it nothing.
   */
  threw(matchup: Matchup, seen: ReadonlySet<string> = new Set()): void {
    const species = matchup.opponent.species;

    if (species === null) {
      return;
    }

    const had = this.estimate(matchup)?.energy ?? 0;
    const tally = this.#tallyOf(species);
    const names =
      seen.size >= MOVES_HELD
        ? [...seen]
        : formsOf(this.#data, matchup.opponent).flatMap((form) => chargedOf(form, this.#meta?.movesets.get(species)));
    const cheapest = Math.min(...names.map((name) => this.#costOf(name)).filter((cost) => cost > 0));

    tally.had = had;
    tally.carried = Math.max(0, had - (Number.isFinite(cheapest) ? cheapest : 0));

    for (const stretch of tally.stretches) {
      stretch.lost = 0;
    }
  }

  /**
   * The banner named the charged move `species` threw last, which settles what the throw cost: what it had then, less
   * the move's own cost rather than the cheapest it could have been. Had it less than the move costs, the count was
   * short, and nothing is left. A banner for a throw not counted, or already settled, changes nothing.
   */
  named(species: string, move: string): void {
    const tally = this.#tallies.get(species);
    const cost = this.#costOf(move);

    if (tally?.had === undefined || cost <= 0) {
      return;
    }

    tally.carried = Math.max(0, tally.had - cost);
    tally.had = undefined;
  }

  /**
   * The opponent's energy as counted, or null where it cannot be: its species unknown, or HP lost that no step or
   * build says how many hits held.
   */
  estimate(matchup: Matchup): Estimate | null {
    const species = matchup.opponent.species;

    if (species === null) {
      return null;
    }

    const tally = this.#tallyOf(species);
    const fast = this.#fastOf({ species, types: matchup.opponent.types }, tally);

    if (fast === undefined) {
      return null;
    }

    const gain = this.#data.combat[fast]?.energy ?? 0;
    let hits = 0;

    for (const stretch of tally.stretches) {
      if (stretch.lost === 0) {
        continue;
      }

      const step = stretch.steps.length > 0 ? median(stretch.steps) : Math.min(...this.#fractions(fast, stretch));

      if (!Number.isFinite(step) || step <= 0) {
        return null;
      }

      hits += Math.round(stretch.lost / step);
    }

    return { energy: Math.min(FULL, tally.carried + hits * gain), fast, gain };
  }

  /** What a charged move costs, as a positive energy, or 0 for a move not known to cost any. */
  #costOf(move: string): number {
    return -(this.#data.combat[move]?.energy ?? 0);
  }

  #tallyOf(species: string): Tally {
    const tally = this.#tallies.get(species) ?? { stretches: [], carried: 0 };
    this.#tallies.set(species, tally);

    return tally;
  }

  /**
   * Which fast move the steps are: of those its forms are allowed for, the one whose hit the damage model puts nearest
   * the median step, by ratio, over every stretch that has one. Before any step, PvPoke's recommended one where it
   * ranks the species, and otherwise the one gaining energy fastest, which counts the most energy.
   */
  #fastOf(opponent: Shown & { species: string }, tally: Tally): string | undefined {
    const { species } = opponent;
    const forms = formsOf(this.#data, opponent).filter((form) => !form.costume);
    const pool = [...new Set(forms.flatMap((form) => form.moves.filter((m) => m.fast).map((m) => m.name)))].filter(
      (name) => name in this.#data.combat,
    );
    const moveset = this.#meta?.movesets.get(species);
    const plausible = moveset ? pool.filter((name) => moveset.fastMoves.includes(name)) : [];
    const candidates = plausible.length > 0 ? plausible : pool;

    // Only stretches the model can check: one read before our CP, or theirs with no cap to take it as, has no build to
    // say what a hit takes, and would rule out every move alike rather than any one.
    const measured = tally.stretches.filter((stretch) => stretch.steps.length > 0 && this.#modelled(stretch));

    if (measured.length > 0) {
      const misfit = (fast: string) =>
        measured.reduce((sum, stretch) => {
          const fractions = this.#fractions(fast, stretch);
          const step = median(stretch.steps);

          return sum + Math.min(Infinity, ...fractions.map((f) => Math.abs(Math.log(step / f))));
        }, 0);
      const [nearest] = [...candidates].sort((a, b) => misfit(a) - misfit(b));

      if (nearest !== undefined && Number.isFinite(misfit(nearest))) {
        return nearest;
      }
    }

    if (moveset && candidates.includes(moveset.fast)) {
      return moveset.fast;
    }

    const rate = (name: string) => {
      const move = this.#data.combat[name];

      return move ? move.energy / move.turns : 0;
    };

    return [...candidates].sort((a, b) => rate(b) - rate(a))[0];
  }

  /** Whether both sides of a stretch have a build, which what a hit takes is modelled from. */
  #modelled({ matchup }: Stretch): boolean {
    return (
      buildsOf(this.#data, capped(matchup.opponent, matchup.cap), matchup.cap).length > 0 &&
      buildsOf(this.#data, matchup.own, matchup.cap).length > 0
    );
  }

  /** What one hit of `fast` takes of our bar in a stretch, for every pairing of builds whose attacker can hold it. */
  #fractions(fast: string, { matchup }: Stretch): number[] {
    const move = this.#data.combat[fast];
    const attackers = buildsOf(this.#data, capped(matchup.opponent, matchup.cap), matchup.cap).filter((attacker) =>
      attacker.form.moves.some((m) => m.name === fast),
    );
    const defenders = buildsOf(this.#data, matchup.own, matchup.cap);

    return move
      ? attackers.flatMap((attacker) =>
          defenders.map((defender) => hit(this.#data, move, attacker, defender) / defender.build.hp),
        )
      : [];
  }
}
