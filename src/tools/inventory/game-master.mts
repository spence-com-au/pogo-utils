/**
 * What the game itself knows about every species, form and move, from its decoded game master and English string table.
 *
 * The screen says a Pokémon's form only by implication, but it follows from numbers that are shown: HP is a pure
 * function of the base stamina, the stamina IV and the level's CP multiplier, so given PGSharp's overlay a form is
 * whichever base stats reproduce the HP. That separates only forms differing in stamina, where CP would also catch a
 * difference in Attack or Defense — but CP is the one number that does not survive OCR, and read wrongly it rules out
 * the right form rather than merely failing to choose. Types carry most of the rest, and what is left is an
 * alternative to report rather than one to pick.
 *
 * The tables and the arithmetic over them, which a browser runs as readily as Node. Where the tables come from is
 * `download.mts` for `pnpm inventory` and the vended `fixtures/game-master.json` for the corpus and the Inventory page.
 */

import { fold } from './ocr.mts';

export interface Form {
  dex: number;
  species: string;
  costume: boolean;
  types: string[];
  attack: number;
  defense: number;
  stamina: number;

  /** `Alola`, `Paldea Aqua`, or null for the ordinary form, as the overlay spells it. */
  form: string | null;

  /**
   * The file `pogo_assets` holds this form's artwork under, or null where it holds none — the only thing that
   * separates forms whose stats and types are identical.
   *
   * A null is a statement about the game rather than a gap in the data: the game master lists every form Niantic's
   * data knows where the directory holds the ones the game draws, so a form with no icon is one no artwork could ever
   * have narrowed.
   */
  icon: string | null;

  /**
   * Every move this form can hold: the ordinary pools, the elite ones a legacy Pokémon may carry, Rayquaza's
   * untradeable Dragon Ascent, the Frustration and Return a shadow or purified one has, and what a change into the form
   * hands over, as Black Kyurem's Freeze Shock, or a grant kept by hand where the game master records no change, as
   * Origin Forme Palkia's Spacial Rend. Reading a move against this rather than all 328 is the difference between
   * choosing among three and among hundreds.
   */
  moves: readonly Move[];

  /**
   * The candy each of this form's evolutions costs, which the detail screen's `EVOLVE` row prints and which is all that
   * separates Sinistea's Phony form, at 50, from its Antique one, at 400. Empty where the game master records none — a
   * statement about the game master rather than the screen: a costumed Pikachu has no branch of its own and its screen
   * still offers to evolve it for 50.
   */
  evolveCandy: readonly number[];
}

export interface Move {
  name: string;
  fast: boolean;
}

/** A move as trainer battles have it, which is not as raids do: Aqua Tail is 55 power here and 50 there. */
export interface CombatMove {
  type: string;
  power: number;

  /** What the move does to its user's energy: what a fast move gains, and what a charged move costs, as a negative. */
  energy: number;

  /**
   * How many half-second turns a fast move takes, from one to five: the game master's `durationTurns`, which counts the
   * turns after the first and is left out where there are none. A charged move is 1, its time being the minigame's.
   */
  turns: number;

  /** The stat stages the move changes, and the chance it does: the game master's `buffs`. Absent where it changes none. */
  buffs?: Buffs;
}

/**
 * Stat stages a move moves, from −4 to +4, on its user (`own`) and on its target (`their`), each left out where it
 * stays put, and the chance that all of them happen at once: Ancient Power raises both of its user's by 1 a tenth of
 * the time, Close Combat drops its user's defense by 2 every time.
 */
export interface Buffs {
  chance: number;
  ownAttack?: number;
  ownDefense?: number;
  theirAttack?: number;
  theirDefense?: number;
}

export interface GameData {
  forms: Form[];
  moves: Move[];
  species: string[];
  types: string[];

  /** Every level from 1 to 51 in half steps, against its CP multiplier. */
  cpm: [number, number][];

  /**
   * Every move's trainer-battle numbers, by its name. A table of its own rather than fields on `Move`, which the form
   * pools repeat 10,000 times over in the vended copy.
   */
  combat: Record<string, CombatMove>;

  /** What a move of the first type multiplies its damage by against a Pokémon of the second, by type name. */
  effectiveness: Record<string, Record<string, number>>;
}

export interface IVs {
  attack: number;
  defense: number;
  stamina: number;
}

/**
 * The CP the game shows, which the scanner works out rather than reads: CP is white over the artwork and the one number
 * on the detail screen that does not survive OCR, coming back as `ce1385` on one species and as nothing at all on
 * another, where the overlay hands over the level and the IVs that determine it exactly. Derived it also agrees with
 * the screen where reading it did not — 635 for a level 31 Shroomish at 10/7/10, against a `CP 635` that read as null.
 */
export function cpOf(form: Form, iv: IVs, multiplier: number): number {
  const a = form.attack + iv.attack;
  const d = form.defense + iv.defense;
  const s = form.stamina + iv.stamina;

  return Math.max(10, Math.floor((a * Math.sqrt(d) * Math.sqrt(s) * multiplier * multiplier) / 10));
}

/** The CP multiplier for a level, or null where nothing is at that level — the half steps stop at 51. */
export function multiplierOf(data: GameData, level: number): number | null {
  return data.cpm.find(([l]) => l === level)?.[1] ?? null;
}

export function hpOf(form: Form, iv: IVs, multiplier: number): number {
  return Math.max(10, Math.floor((form.stamina + iv.stamina) * multiplier));
}

/**
 * Every level at which this form with these IVs shows exactly this maximum HP. Usually a handful of adjacent half
 * levels rather than one, since `hpOf` floors and neighbouring multipliers are close enough to land on the same
 * integer; the level the overlay states is what picks among them.
 */
export function levelsOf(data: GameData, form: Form, iv: IVs, hp: number): number[] {
  return data.cpm.filter(([, m]) => hpOf(form, iv, m) === hp).map(([level]) => level);
}

/**
 * Levenshtein distance over folded text, so case, accents and OCR's stray punctuation cost nothing. `within` measures
 * `a` against the nearest stretch of `b` rather than all of it, which costs nothing for what it leaves off either end:
 * `TIVE` is no distance within SUPER EFFECTIVE.
 */
export function distance(a: string, b: string, within = false): number {
  const s = fold(a).replaceAll(' ', '');
  const t = fold(b).replaceAll(' ', '');
  let previous = Array.from({ length: t.length + 1 }, (_, i) => (within ? 0 : i));

  for (let i = 1; i <= s.length; i++) {
    const current = [i];

    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost));
    }

    previous = current;
  }

  return within ? Math.min(...previous) : (previous[t.length] ?? 0);
}

/**
 * The candidate nearest to what OCR read, if it is near enough to be a misreading rather than a different word: a
 * quarter of the length, so `Pikachv` is Pikachu and `Sparky` is not Sparkling anything.
 */
export function closest<T>(text: string, candidates: readonly T[], name: (c: T) => string, slack = 0.25): T | null {
  const length = fold(text).replaceAll(' ', '').length;

  if (length < 3) {
    return null;
  }

  let best: T | null = null;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    const d = distance(text, name(candidate));

    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }

  return bestDistance <= Math.max(1, Math.floor(length * slack)) ? best : null;
}
