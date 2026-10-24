/**
 * How much a charged move takes off in a trainer battle, in HP, and so whether the one coming would faint us: what
 * `strategy.mts` never needs, its comparisons being between one Pokémon's own moves, where every stat cancels.
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
import { chargedOf, effectiveness, STAB, stage } from './strategy.mts';

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

/** One side as the HUD shows it, either half of which may not have been read. */
export interface Side {
  species: string | null;
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
 * Every form a species could be, as `typesOf` takes them, each built rank 1 for the CP read. None where the species or
 * the CP is unknown, or where the CP is over the league's cap and so misread; no cap is Master League's.
 */
export function buildsOf(data: GameData, side: Side, cap: number | null): Battler[] {
  const { species, cp } = side;

  if (cp === null || (cap !== null && cp > cap)) {
    return [];
  }

  return data.forms
    .filter((form) => form.species === species && !form.costume)
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

  // The hardest hit of all, as a share of our maximum HP: past `FAINTS` of what is left on any of our forms is past it
  // on the form it hurts most.
  let hardest = { name: '', share: 0 };
  let narrowed = false;

  for (const attacker of theirs) {
    const names = seen.size >= MOVES_HELD ? [...seen] : chargedOf(attacker.form, moveset);
    const allowed = names.flatMap((name) => (data.combat[name] ? [{ name, move: data.combat[name] }] : []));
    const afforded = allowed.filter(({ move }) => affordable === undefined || -move.energy <= affordable);
    const moves = afforded.length > 0 ? afforded : allowed;

    narrowed ||= moves.length < allowed.length;

    if (moves.length === 0) {
      return { faints: true, why: `no charged move known for ${attacker.form.species}` };
    }

    for (const defender of ours) {
      for (const { name, move } of moves) {
        const share = hit(data, move, attacker, defender, stages.their.attack, stages.own.defense) / defender.build.hp;

        if (share > hardest.share) {
          hardest = { name, share };
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
  };
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
 * move under each lit button, and `stages` each side's as `wouldFaint` takes them: our attack and their defense move
 * the hit.
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
  lit: ReadonlyMap<number, string>,
  own: Side,
  opponent: Side,
  hp: number | null,
  shields: number,
  cap: number | null,
  stages: { own: Stages; their: Stages } = { own: NO_STAGES, their: NO_STAGES },
): { x: number; why: string } | undefined {
  const ours = buildsOf(data, own, cap);
  const theirs = buildsOf(data, opponent, cap);

  if (shields > 0 || hp === null || ours.length === 0 || theirs.length === 0) {
    return undefined;
  }

  const finishing = [...lit].flatMap(([x, name]) => {
    const move = data.combat[name];

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

  return cheapest && { x: cheapest.x, why: `would finish ${opponent.species ?? 'the opponent'} at ${percent(hp)}` };
}
