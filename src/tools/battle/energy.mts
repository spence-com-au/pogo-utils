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
 *
 * Our own fast moves' hits are measured off the opponent's bar the same way, and with the count they say whether those
 * alone finish it before it can throw, and so whether our charged moves are better kept for the next one: `spare`.
 */

import { type GameData } from '../inventory/game-master.mts';
import { buildsOf, capped, hit, MOVES_HELD, type Side } from './damage.mts';
import { type Meta } from './meta.mts';
import { chargedOf, formsOf, type Shown } from './strategy.mts';

/** As much energy as a Pokémon can hold. */
export const FULL = 100;

/**
 * How close together two readings of a bar must be for the drop between them to be one hit, in milliseconds: a fast
 * move takes at least a turn of 500ms, so two cannot both land in less.
 */
const CLEAN_MS = 500;

/**
 * The least drop of a bar that counts as a hit rather than a misread, as a fraction of it: a pixel of the 100 either
 * side's bar runs at 360 wide. A 1-power Lock-On can take less, and goes uncounted below it.
 */
const LEAST = 0.01;

/** The two Pokémon facing each other, and the league's cap their CPs are read against. */
export interface Matchup {
  own: Side;
  opponent: Side;
  cap: number | null;
}

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[sorted.length >> 1] ?? 0;
};

/**
 * One bar's drops as read, outside anything that pauses the fight: how much of it they have taken, and among them the
 * clean steps, each a drop between two readings less than `CLEAN_MS` apart and so one hit.
 */
class Steps {
  /** How much of the bar fast moves have taken since this was last settled: of ours, by the opponent's throw. */
  lost = 0;

  /** Every clean step seen, which outlive a throw: they say what one hit takes. */
  readonly steps: number[] = [];

  /** The bar at its lowest yet, and when it was read: the reading the next drop is measured from. */
  #low: number | null = null;
  #at = 0;

  read(at: number, hp: number): void {
    if (this.#low === null) {
      this.#low = hp;
      this.#at = at;
      return;
    }

    const drop = this.#low - hp;

    if (drop >= LEAST) {
      this.lost += drop;

      if (at - this.#at < CLEAN_MS) {
        this.steps.push(drop);
      }

      this.#low = hp;
    }

    // Read again without a drop, the next one is measured from this reading's time: a bar read every frame has a step
    // land between two readings a frame apart.
    if (drop > -LEAST) {
      this.#at = at;
    }
  }

  /** Anything the fight pauses for, or the bar unread across: the next reading is measured from afresh. */
  pause(): void {
    this.#low = null;
  }

  /** What one hit takes of the bar, the median clean step, or undefined before any. */
  get step(): number | undefined {
    return this.steps.length > 0 ? median(this.steps) : undefined;
  }
}

/** A stretch of the fight between the same two Pokémon, and the steps off one of their bars. */
class Stretch extends Steps {
  readonly matchup: Matchup;

  constructor(matchup: Matchup) {
    super();
    this.matchup = matchup;
  }
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

const keyOf = ({ own, opponent }: Matchup) =>
  [own, opponent].map(({ species, cp, types }) => `${species}|${cp}|${types?.join('/')}`).join('|');

/** What a charged move costs, as a positive energy, or 0 for a move not known to cost any. */
const costOf = (data: GameData, move: string) => -(data.combat[move]?.energy ?? 0);

/**
 * What the cheapest charged move `opponent` is allowed for costs: of the two `seen`, once both have been, and otherwise
 * of those `chargedOf` allows its forms. Infinity where none is known to cost anything.
 */
function cheapestOf(data: GameData, opponent: Side, seen: ReadonlySet<string>, meta?: Meta | null): number {
  const moveset = opponent.species === null ? undefined : meta?.movesets.get(opponent.species);
  const names =
    seen.size >= MOVES_HELD ? [...seen] : formsOf(data, opponent).flatMap((form) => chargedOf(form, moveset));

  return Math.min(...names.map((name) => costOf(data, name)).filter((cost) => cost > 0));
}

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
      this.#stretch = new Stretch(matchup);
      tally.stretches.push(this.#stretch);
    }

    this.#stretch.read(at, hp);
  }

  /** Anything the fight pauses for, or our bar unread across: the next reading is measured from afresh. */
  pause(): void {
    this.#stretch?.pause();
  }

  /** What one of the opponent's fast moves takes of our bar in this stretch, measured, or undefined before any step. */
  get step(): number | undefined {
    return this.#stretch?.step;
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
    const cheapest = cheapestOf(this.#data, matchup.opponent, seen, this.#meta);

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
    const cost = costOf(this.#data, move);

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

      const step = stretch.step ?? Math.min(...this.#fractions(fast, stretch));

      if (!Number.isFinite(step) || step <= 0) {
        return null;
      }

      hits += Math.round(stretch.lost / step);
    }

    return { energy: Math.min(FULL, tally.carried + hits * gain), fast, gain };
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

/**
 * What one of our fast moves takes of the opponent's bar, measured as `Energy` measures theirs on ours: the median clean
 * step off it, per stretch the same two Pokémon face each other, a newcomer on either side hitting or being hit
 * differently. Nothing is measured while the opponent's species is unread, as after a fuller bar says it was replaced.
 */
export class Hits {
  #stretch: Stretch | undefined;

  /** The opponent's bar read at `at` milliseconds, outside anything that pauses the fight. */
  read(at: number, hp: number, matchup: Matchup): void {
    if (matchup.opponent.species === null) {
      this.#stretch = undefined;
      return;
    }

    if (!this.#stretch || keyOf(this.#stretch.matchup) !== keyOf(matchup)) {
      this.#stretch = new Stretch(matchup);
    }

    this.#stretch.read(at, hp);
  }

  pause(): void {
    this.#stretch?.pause();
  }

  get step(): number | undefined {
    return this.#stretch?.step;
  }
}

/**
 * The most of our fast moves left to finish the opponent for a lit charged move to be held for the next one. Four, for
 * the Ultra League footage that asked for the hold: a Galarian Moltres's Sucker Punch takes 4.3% of a rank-1 Altered
 * Giratina by `hit`, and the 15% that Giratina was left at, with the bar's wander, is four of them. Each hit more is
 * more of the opponent's fast moves landing on a count that allows for only one it missed.
 */
const SPARE_HITS = 4;

/** How far a steady bar wanders from itself frame to frame: 2 points, as `health.mts`'s `JUMP` measured it. */
const WANDER = 0.02;

/** The fight as it stands, which `spare` weighs. */
export interface Standing {
  matchup: Matchup;

  /** Each side's HP, as the fraction of its bar the HUD shows. */
  hp: { own: number | null; opponent: number | null };

  /** The opponent's shields left, and its Pokémon left by the Poké Balls, the one out among them. */
  shields: number;
  left: number | null;

  /** What one hit takes of the other's bar: ours of theirs, as `Hits` measures it, and theirs of ours, as `Energy` does. */
  steps: { ours: number | undefined; theirs: number | undefined };

  /** The opponent's energy, as `Energy` counts it. */
  estimate: Estimate | null;

  /** The charged moves the opponent has been seen to use. */
  seen?: ReadonlySet<string>;
}

/**
 * Why every charged move of ours should be held for the opponent's next Pokémon, or undefined where a throw should go:
 * our fast moves alone are to finish this one, in `SPARE_HITS` of them at most, before it can throw, and the energy
 * kept lands on the next the moment it is out rather than being spent on a sliver. A player in Ultra League held Brave
 * Bird and Fly while Galarian Moltres's fast moves finished a Giratina at 15% with no shields left, and threw Brave Bird
 * the moment the Mewtwo after it landed, which won the game.
 *
 * Only where all of these hold, anything unknown leaving the throw to go:
 *
 * - The opponent's shields are spent: one left is what a player would draw before anything else.
 * - It has another Pokémon to come. With its last, a finish is a finish however it comes.
 * - Our hits on its bar have been measured, and `SPARE_HITS` of them at most take what it has left and the bar's wander.
 * - Its energy, as counted, affords none of its charged moves after the fast moves of its that land meanwhile and one
 *   more for a hit the count missed. Meanwhile is our hits at the longest of our forms' fast moves, and never counts
 *   fewer of its fast moves than of ours, whatever the turns say.
 * - Those fast moves of its, at what one was measured to take of our bar, leave us standing: a Pokémon fainted carries
 *   no energy on.
 */
export function spare(data: GameData, standing: Standing, meta?: Meta | null): string | undefined {
  const { matchup, hp, shields, left, steps, estimate, seen = new Set<string>() } = standing;
  const { species } = matchup.opponent;

  if (
    shields > 0 ||
    left === null ||
    left <= 1 ||
    species === null ||
    hp.own === null ||
    hp.opponent === null ||
    steps.ours === undefined ||
    steps.theirs === undefined ||
    estimate === null
  ) {
    return undefined;
  }

  const turns = (name: string) => data.combat[name]?.turns ?? 0;
  const ours = Math.ceil((hp.opponent + WANDER) / steps.ours);
  const ourTurns = Math.max(
    ...formsOf(data, matchup.own).flatMap((form) => form.moves.filter((m) => m.fast).map((m) => turns(m.name))),
  );
  const theirTurns = turns(estimate.fast);

  if (ours > SPARE_HITS || !(ourTurns > 0) || !(theirTurns > 0)) {
    return undefined;
  }

  const theirs = Math.max(ours, Math.ceil((ours * ourTurns) / theirTurns)) + 1;
  const cheapest = cheapestOf(data, matchup.opponent, seen, meta);

  if (
    !Number.isFinite(cheapest) ||
    estimate.energy + theirs * estimate.gain >= cheapest ||
    theirs * steps.theirs >= hp.own - WANDER
  ) {
    return undefined;
  }

  return `fast moves finish ${species} at ${Math.round(hp.opponent * 100)}%`;
}
