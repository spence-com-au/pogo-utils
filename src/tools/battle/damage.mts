/**
 * How much a charged move takes off in a trainer battle, in HP, and so whether the one coming would faint us and
 * whether to shield it: what `strategy.mts` never needs, its comparisons being between one Pokémon's own moves, where
 * every stat cancels.
 *
 * The HUD shows each side's species and CP and nothing else that damage depends on: not the IVs, not the level and
 * not which charged moves the opponent has. So the moves are the worst its forms can hold, or in a league PvPoke ranks
 * the worst its players run, and the IVs are the ones a player would have picked for a league — the rank-1 spread,
 * whose attack × defense × HP is the highest the CP allows.
 *
 * What it does see is the charged moves thrown, ours as we throw them and theirs off the banner after each shield
 * prompt, and so the stat stages those move: their attack and our defense, as they stand, go into the hit.
 */

import { cpOf, type CombatMove, type Form, type GameData, type IVs } from '../inventory/game-master.mts';
import { type Meta } from './meta.mts';
import { chargedOf, effectiveness, formsOf, STAB, stage, type Pick, type Shown } from './strategy.mts';

/**
 * What a charged move's damage is multiplied by in a trainer battle and not in a raid: the game master's
 * `COMBAT_SETTINGS.chargeAttackBonusMultiplier`, which `download.mts` does not keep.
 */
const PVP_BONUS = 1.3;

/**
 * How much of what is left a hit must take to count as fainting. Short of all of it, since the HP left is read off a
 * bar and the opponent's build is a guess, and a shield spent a hit early costs less than a Pokémon lost.
 */
const FAINTS = 0.9;

/** A form at one level with one IV spread, and the stats that follow: attack and defense unrounded, HP as shown. */
export interface Build {
  iv: IVs;
  level: number;
  attack: number;
  defense: number;
  hp: number;
}

/** One form of a species as it is assumed to be built. */
export interface Battler {
  form: Form;
  build: Build;
}

/** One side as the HUD shows it, any of which may not have been read. */
export interface Side extends Shown {
  cp: number | null;
}

/** One side's attack and defense stages, each from −4 to +4. */
export interface Stages {
  attack: number;
  defense: number;
}

export const NO_STAGES: Stages = { attack: 0, defense: 0 };

/** How far a stage can go either way. */
const MAX_STAGE = 4;

const clamp = (stages: number) => Math.max(-MAX_STAGE, Math.min(MAX_STAGE, stages));

/**
 * The stages of a move's `user` and of its `target` once it is thrown, shielded or not: a shield stops the damage and
 * not the stat change, so a shielded Superpower still drops its user and a shielded Icy Wind still drops its target.
 * Only a change that always happens counts. One left to chance — Ancient Power's tenth, Crunch's fifth — is taken not
 * to have, nothing on screen saying whether it did.
 */
export function afterThrow(move: CombatMove | undefined, user: Stages, target: Stages): [user: Stages, target: Stages] {
  const buffs = move?.buffs;

  if (buffs?.chance !== 1) {
    return [user, target];
  }

  return [
    { attack: clamp(user.attack + (buffs.ownAttack ?? 0)), defense: clamp(user.defense + (buffs.ownDefense ?? 0)) },
    {
      attack: clamp(target.attack + (buffs.theirAttack ?? 0)),
      defense: clamp(target.defense + (buffs.theirDefense ?? 0)),
    },
  ];
}

const BUILDS = new WeakMap<Form, Map<number, Build | null>>();

/**
 * The rank-1 build of a form showing `cp`: of every IV spread at the highest level it stays at or under `cp`, the one
 * with the greatest attack × defense × HP, as PvPoke's `generateIVCombinations` ranks them; null where nothing is that
 * low. Every level the table holds, 51 being a best buddy's.
 *
 * Rank 1 for the CP read rather than for the league's cap, since a Pokémon well under the cap — a CP 1826 Magmar in
 * Ultra League — was not built to it, and the cap's spread levelled down to 1826 is one chosen for a CP it does not
 * have. This asks the cap's question of the CP actually shown instead, and the answers agree wherever the read is the
 * cap's own rank-1 CP. A spread that shows exactly `cp` at some level beats a stronger one that only fits under it,
 * since the read rules the latter out; where none does, as a misread may leave it, the strongest under it stands.
 *
 * Once per form and CP, the 4096 spreads being worth searching once but not every frame.
 */
export function rankOne(data: GameData, form: Form, cp: number): Build | null {
  const cached = BUILDS.get(form) ?? new Map<number, Build | null>();
  BUILDS.set(form, cached);

  if (cached.has(cp)) {
    return cached.get(cp) ?? null;
  }

  let best: { build: Build; exact: boolean; product: number } | null = null;

  for (let attack = 0; attack <= 15; attack++) {
    for (let defense = 0; defense <= 15; defense++) {
      for (let stamina = 0; stamina <= 15; stamina++) {
        const iv = { attack, defense, stamina };
        const fit = data.cpm.findLast(([, m]) => cpOf(form, iv, m) <= cp);

        if (!fit) {
          continue;
        }

        const [level, m] = fit;
        const build = {
          iv,
          level,
          attack: (form.attack + attack) * m,
          defense: (form.defense + defense) * m,
          hp: Math.max(10, Math.floor((form.stamina + stamina) * m)),
        };
        const exact = cpOf(form, iv, m) === cp;
        const product = build.attack * build.defense * build.hp;

        if (!best || (exact && !best.exact) || (exact === best.exact && product > best.product)) {
          best = { build, exact, product };
        }
      }
    }
  }

  cached.set(cp, best?.build ?? null);

  return best?.build ?? null;
}

/**
 * Every form a side could be, as `typesOf` takes them, each built rank 1 for the CP read. None where the species or
 * the CP is unknown, or where the CP is over the league's cap and so misread; no cap is Master League's.
 */
export function buildsOf(data: GameData, side: Side, cap: number | null): Battler[] {
  const { cp } = side;

  if (cp === null || (cap !== null && cp > cap)) {
    return [];
  }

  return formsOf(data, side)
    .filter((form) => !form.costume)
    .flatMap((form) => {
      const build = rankOne(data, form, cp);

      return build ? [{ form, build }] : [];
    });
}

/**
 * The opponent as it is built: a CP not read taken as the league's cap, where there is one, and so built rank 1 for it
 * as most of what a league fields is. Left unknown, it would take every shield for as long as the CP goes unread — a
 * minute of an Ultra League battle in one run — on hits that mostly would not faint us. Ours is never taken so, being
 * ours to read, where a guess would only hide the misread.
 */
export function capped(opponent: Side, cap: number | null): Side {
  return opponent.cp === null && cap !== null ? { ...opponent, cp: cap } : opponent;
}

/**
 * The HP a charged move takes, `floor(0.5 × power × attack / defense × STAB × effectiveness × 1.3) + 1`, which is
 * PvPoke's `DamageCalculator.damage` (pvpoke/pvpoke@415436c, `src/js/battle/DamageCalculator.js`), its
 * `DamageMultiplier.BONUS` of 1.3 and `STAB` of 1.2 being the game master's `chargeAttackBonusMultiplier` and
 * `sameTypeAttackBonusMultiplier`. The game holds them as float32, PvPoke's BONUS being 1.2999999523…, which can move a
 * hit by 1 HP where it lands on a whole number; nothing `FAINTS` decides is that close.
 *
 * Neither side counts as a shadow, which nothing read yet tells apart: a shadow opponent hits a fifth harder than this
 * (`shadowPokemonAttackBonusMultiplier`), and a shadow of ours takes a fifth more.
 *
 * `attack` is the attacker's attack stage and `defense` the defender's defense stage, each scaling its stat by `stage`,
 * as PvPoke's `Pokemon.getEffectiveStat` does.
 */
export function hit(
  data: GameData,
  move: CombatMove,
  attacker: Battler,
  defender: Battler,
  attack = 0,
  defense = 0,
): number {
  const stab = attacker.form.types.includes(move.type) ? STAB : 1;
  const ratio = (attacker.build.attack * stage(attack)) / (defender.build.defense * stage(defense));

  return (
    Math.floor(0.5 * move.power * ratio * stab * effectiveness(data, move.type, defender.form.types) * PVP_BONUS) + 1
  );
}

/** How many charged moves a Pokémon holds at most: its own and one unlocked with a second. */
export const MOVES_HELD = 2;

/** Whether a hit would faint us, and why that is the answer: the hardest hit and how much it takes, or what is unknown. */
export interface Verdict {
  faints: boolean;
  why: string;

  /** The hardest move, where the hit was calculated: undefined where something unknown decided `faints` instead. */
  hardest?: string;

  /** How much of our maximum HP `hardest` would take, on the form of ours it hurts most. */
  share?: number;

  /**
   * The hardest of every charged move allowed for, whatever the opponent's counted energy affords, and how much of our
   * maximum HP it would take: `hardest` again where the count rules out nothing harder.
   */
  worst?: { name: string; share: number };

  /**
   * The hardest move, where it is one the opponent's counted energy affords. Undefined where the energy is not counted,
   * or where the count affords nothing and so every move is allowed for.
   */
  afforded?: string;
}

/** Why `whose` side, as `our` or `their`, has no build: what of it went unread, or a CP over `cap` and so misread. */
function unbuilt({ species, cp }: Side, cap: number | null, whose: string): string {
  if (species === null) {
    return `${whose} species unread`;
  }

  if (cp === null) {
    return `${whose} CP unread`;
  }

  return cap !== null && cp > cap
    ? `${whose} CP ${cp} is over the ${cap} cap, so misread`
    : `no ${species} at CP ${cp}`;
}

const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

/** The stages that moved a hit, as `their attack +1, our defense -2`, or nothing where none did. */
function staged(attack: number, defense: number): string {
  const moved = [
    ...(attack === 0 ? [] : [`their attack ${attack > 0 ? '+' : ''}${attack}`]),
    ...(defense === 0 ? [] : [`our defense ${defense > 0 ? '+' : ''}${defense}`]),
  ];

  return moved.length > 0 ? ` (${moved.join(', ')})` : '';
}

/**
 * Whether the opponent's hardest charged move would take at least `FAINTS` of the HP we have left, `hp` being the
 * fraction of our maximum the bar shows, and why. Hardest of every charged move `chargedOf` allows any of its forms —
 * those its players run, where `meta` ranks its species, and otherwise every one bar Frustration and Return — against
 * whichever of our forms it hurts most. Their CP unread is taken as `cap`, as `capped` takes it, and `why` says so.
 * Anything else not known — either species, our CP, theirs where there is no cap, a CP over `cap`, the HP left or a
 * move of theirs — counts as fainting, a shield being the safe side to err on, and is what `why` names.
 *
 * `seen` is the charged moves this opponent has been seen to use, which outweighs what its players run. Both of them
 * seen, they are all it has, whatever its form. One seen narrows nothing: the other could be any allowed it, the
 * hardest among them.
 *
 * Of those, only the ones costing no more than `affordable` where it is given, the energy the opponent is counted as
 * having, unless that leaves none, which says the count is short rather than that nothing was thrown.
 *
 * `stages` is each side's stat stages as the moves thrown have left them, `afterThrow`'s: their attack and our defense
 * move the hit, and `why` names them where they do.
 */
export function wouldFaint(
  data: GameData,
  own: Side,
  opponent: Side,
  hp: number | null,
  cap: number | null,
  meta?: Meta | null,
  seen: ReadonlySet<string> = new Set(),
  affordable?: number,
  stages: { own: Stages; their: Stages } = { own: NO_STAGES, their: NO_STAGES },
): Verdict {
  const ours = buildsOf(data, own, cap);
  const theirs = buildsOf(data, capped(opponent, cap), cap);

  if (hp === null) {
    return { faints: true, why: 'our HP unread' };
  }

  if (ours.length === 0) {
    return { faints: true, why: unbuilt(own, cap, 'our') };
  }

  if (theirs.length === 0) {
    return { faints: true, why: unbuilt(opponent, cap, 'their') };
  }

  const moveset = opponent.species === null ? undefined : meta?.movesets.get(opponent.species);

  // The hardest hits, as shares of our maximum HP: past `FAINTS` of what is left on any of our forms is past it on the
  // form it hurts most. `hardest` is the hardest of the moves the count affords, or of every move allowed for where it
  // affords none; `worst` the hardest of every move allowed for, whatever the count affords, for `wouldShield`.
  let hardest = { name: '', share: 0, afforded: false };
  let worst = { name: '', share: 0 };
  let narrowed = false;

  for (const attacker of theirs) {
    const names = seen.size >= MOVES_HELD ? [...seen] : chargedOf(attacker.form, moveset);
    const allowed = names.flatMap((name) => (data.combat[name] ? [{ name, move: data.combat[name] }] : []));
    const afforded = allowed.filter(({ move }) => affordable === undefined || -move.energy <= affordable);
    const counted = affordable !== undefined && afforded.length > 0;
    const moves = counted ? afforded : allowed;

    narrowed ||= moves.length < allowed.length;

    if (moves.length === 0) {
      return { faints: true, why: `no charged move known for ${attacker.form.species}` };
    }

    for (const defender of ours) {
      for (const entry of allowed) {
        const { name, move } = entry;
        const share = hit(data, move, attacker, defender, stages.their.attack, stages.own.defense) / defender.build.hp;

        if (share > hardest.share && moves.includes(entry)) {
          hardest = { name, share, afforded: counted };
        }

        if (share > worst.share) {
          worst = { name, share };
        }
      }
    }
  }

  const taken = `${hardest.name} would take ~${percent(hardest.share)}, with ${percent(hp)} left`;
  const afforded = narrowed ? `, the hardest ${affordable ?? 0} energy affords` : '';
  const assumed = opponent.cp === null ? ` (their CP unread, taken as the ${cap} cap)` : '';

  return {
    faints: hardest.share >= FAINTS * hp,
    why: taken + afforded + staged(stages.their.attack, stages.own.defense) + assumed,
    hardest: hardest.name,
    share: hardest.share,
    worst,
    ...(hardest.afforded && { afforded: hardest.name }),
  };
}

/**
 * What the HP left is divided by for the least a charged move must take of it for its shield to be taken whatever the
 * hit would leave: at least 1/1.4 of it, as PvPoke's `wouldShield` has it.
 */
const HARD = 1.4;

/** Whether to take a shield against the opponent's charged move, and why. */
export interface Shielding {
  shield: boolean;
  why: string;
}

/** The opponent's fast moves, as `energy.mts` measures and counts them. */
export interface Cycle {
  /** What one of them takes of our bar, `Energy.step`: undefined before one has been measured. */
  step: number | undefined;

  /** The opponent's energy as counted, and what each fast move gains: `Energy.estimate`'s, null where uncounted. */
  estimate: { energy: number; gain: number } | null;
}

/**
 * Whether to take a shield against the opponent's charged move, and why: `verdict` is `wouldFaint`'s on it, `hp` the
 * fraction of our bar left and `shields` how many we hold. Taken where any of these holds, the first that does naming
 * why, and otherwise kept:
 *
 * - The hit would faint us, or something it rests on is unknown, as `verdict.faints` says.
 * - Any charged move the opponent is allowed for, `verdict.worst`, would take at least 1/`HARD` of what is left.
 * - What the hit, or any charged move the opponent is allowed for, would leave is no more than its fast moves take
 *   before it can throw the hit's move again, once for each shield we hold: with that little left, ours would faint
 *   before the next shield could be taken. The fast moves are counted off `cycle`, and with either unknown the shield is
 *   taken.
 *
 * The last two are PvPoke's `wouldShield` (pvpoke/pvpoke@d98f521, `src/js/battle/actions/ActionLogic.js` lines
 * 1164–1280), its battle AI's model of whether a player shields: what its baiting asks of the opponent (lines 421 and
 * 894) and its randomized battles weigh, its own simulations taking every shield they can bar a few moves and forms
 * (`src/js/battle/Battle.js` lines 1081–1144). The first alone is too late: in the two Master League sets of GO Battle
 * League logged, 2026-10-28 and 2026-10-29, 9 of the 14 shields it took against a hit it calculated were at 25% HP or
 * less, and 8 of the 13 it kept were against hits that left 26% or less. Palkia at 40% kept one against Zapdos's Drill
 * Peck at ~34%, and fainted 2.5s later with both still up.
 *
 * The fast moves before the next throw are PvPoke's `ceil((cost − max(energy − cost, 0)) / gain) + 1` (line 1192),
 * `energy` being what the opponent has left once it has paid for the hit, as PvPoke's battle has it when it asks
 * (`Battle.js` line 1058, before 1088): the hit's move again, counted from nothing unless a whole cost more is left
 * over, and one more for margin. Where PvPoke calculates what each takes, `cycle.step` is what one was measured to take
 * of our bar; and where it knows the move thrown, the hit is the hardest the count affords. Otherwise unlike PvPoke's:
 *
 * - Its `+ 1` HP of margin a shield, under a point of our bar, is left out.
 * - It asks the 1/1.4 rule only where the fast move does more than 1.5 HP a turn (line 1221), which is left out: it can
 *   only keep a shield the rule would take, against a fast move that barely scratches us, as Magmar's Ember does
 *   Charizard 3 HP in its 2 turns, and a shield taken is the side this errs to.
 * - It shields the first of a run of moves that lower their user's attack, as Superpower does, where it takes over 0.55
 *   of what is left (line 1238). That asks which move is coming, which the prompt never says: the hit here is only the
 *   hardest it could be.
 * - Its overrides for Aegislash, Minior and Cramorant (lines 1248–1274) are left out: they turn on a form or a move
 *   thrown, neither of which the HUD and the prompt tell apart.
 * - It works out the fast moves' damage with the thrown move's own stat changes applied (lines 1176–1188), so that a
 *   Power-Up Punch's +1 attack or an Acid Spray's −2 to our defense raises the cycle. Here the step is as measured
 *   before the throw: the move coming is not named until the banner after the prompt, and the hardest it could be says
 *   nothing of whether it moves a stage.
 */
export function wouldShield(
  data: GameData,
  verdict: Verdict,
  hp: number | null,
  shields: number,
  cycle: Cycle,
): Shielding {
  const { hardest, share, worst } = verdict;

  if (verdict.faints || hp === null || hardest === undefined || share === undefined || worst === undefined) {
    return { shield: true, why: hardest === undefined ? verdict.why : `${verdict.why}; that would faint us` };
  }

  if (worst.share * HARD >= hp) {
    const which = worst.name === hardest ? '' : `${worst.name} would take `;

    return { shield: true, why: `${verdict.why}; ${which}at least 1/${HARD} of what is left` };
  }

  const { step, estimate } = cycle;
  const cost = -(data.combat[hardest]?.energy ?? 0);

  if (step === undefined) {
    return { shield: true, why: `${verdict.why}; their fast moves unmeasured` };
  }

  if (estimate === null || !(estimate.gain > 0) || !(cost > 0)) {
    return { shield: true, why: `${verdict.why}; their energy uncounted` };
  }

  const kept = Math.max(estimate.energy - cost, 0);
  const fast = Math.ceil((cost - Math.max(kept - cost, 0)) / estimate.gain) + 1;
  const cycles = fast * step * shields;
  const times = shields > 1 ? `${shields} × the` : 'the';
  const than = (left: number) =>
    `${left <= cycles ? 'no more' : 'more'} than ${times} ~${percent(fast * step)} of ${fast} fast ` +
    `move${fast === 1 ? '' : 's'} before their next charged move`;

  // Asked of every move allowed for as well as the hit, as PvPoke asks it (line 1226), the cycle being the hit's either
  // way: a harder move the count does not yet afford may be the next.
  if (hp - share > cycles && hp - worst.share <= cycles) {
    return {
      shield: true,
      why: `${verdict.why}; ${worst.name} would leave ~${percent(hp - worst.share)}, ${than(hp - worst.share)}`,
    };
  }

  return { shield: hp - share <= cycles, why: `${verdict.why}; leaves ~${percent(hp - share)}, ${than(hp - share)}` };
}

/**
 * How sure a lit move must be to finish the opponent before it is thrown over the one held for: the hit counted at
 * nine tenths of what the model says, both sides' builds being guesses at rank 1, against the HP the bar shows and 2
 * points more, which a steady bar wanders from itself frame to frame (`health.mts`'s `JUMP`). Too sure costs no more
 * than holding on as before; not sure enough leaves the opponent standing at a sliver with our energy spent.
 */
const FINISH = { hit: 0.9, slack: 0.02 } as const;

/**
 * Which lit button would finish the opponent, by its x, and why: one whose move takes at least the HP its bar shows,
 * `hp` being the fraction of its maximum, by `FINISH`'s margin and against every form either side could be, the
 * lowest of those hits deciding. The cheapest of several, keeping the most energy for the next opponent. `lit` is the
 * buttons lit, of which only those with a move read under them in `moves` are weighed, and `stages` each side's as
 * `wouldFaint` takes them: our attack and their defense move the hit.
 *
 * Only with the opponent's `shields` all spent. With one left, a finishing hit is the one a player shields, and while
 * it has one, baiting already holds for the cheapest move: the rule would decide nothing but which move is shielded.
 *
 * Undefined, leaving the move held for, where nothing lit finishes or where anything it rests on is unknown: either
 * side's species or CP, a CP over `cap`, the opponent's HP or a move's numbers. Their CP unread is not taken as the
 * cap, as `wouldFaint` takes it: a finish is thrown only on what was read.
 */
export function finisher(
  data: GameData,
  moves: ReadonlyMap<number, string>,
  lit: Iterable<number>,
  own: Side,
  opponent: Side,
  hp: number | null,
  shields: number,
  cap: number | null,
  stages: { own: Stages; their: Stages } = { own: NO_STAGES, their: NO_STAGES },
): Pick | undefined {
  const ours = buildsOf(data, own, cap);
  const theirs = buildsOf(data, opponent, cap);

  if (shields > 0 || hp === null || ours.length === 0 || theirs.length === 0) {
    return undefined;
  }

  const finishing = [...lit].flatMap((x) => {
    const move = data.combat[moves.get(x) ?? ''];

    if (!move) {
      return [];
    }

    const shares = ours.flatMap((attacker) =>
      theirs.map(
        (defender) => hit(data, move, attacker, defender, stages.own.attack, stages.their.defense) / defender.build.hp,
      ),
    );

    return FINISH.hit * Math.min(...shares) >= hp + FINISH.slack ? [{ x, cost: -move.energy }] : [];
  });

  const [cheapest] = finishing.sort((a, b) => a.cost - b.cost);

  return (
    cheapest && {
      x: cheapest.x,
      bait: false,
      why: `would finish ${opponent.species ?? 'the opponent'} at ${percent(hp)}`,
    }
  );
}
