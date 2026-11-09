/**
 * Our bench and the switches to it: which benched Pokémon to switch to and when, and which to send in after a faint;
 * the energy each switch leaves banked on the bench; and our switch timer, which is never read off the screen but kept
 * from whether each switch tapped went through.
 */

import { type GameData } from '../inventory/game-master.mts';
import { finisher, NO_STAGES, wouldFaint, type Side, type StagePair, type Stages } from './damage.mts';
import { type Estimate, type Matchup } from './energy.mts';
import { type Health } from './health.mts';
import { place, type Point, type Size } from './layout.mts';
import { type Meta } from './meta.mts';
import { type Card } from './party.mts';
import { BENCH, BENCH_ANCHOR } from './play.mts';
import { type Reporter } from './reporter.mts';
import { clearerOf, counterOf, nextOut, refugeOf, resisterOf, stripperOf, type Switch } from './strategy.mts';

/**
 * How long after a bench card's tap our HUD is read again to see whether the switch took, in milliseconds. Recorded on
 * the Pixel 4 XL, the bench showed the switch by 135.5s and the HUD, hidden behind a banner meanwhile, came back naming
 * the newcomer at 136.3s; a read before then could still find the Pokémon tapped away from.
 */
export const SWITCHED_MS = 2_000;

/**
 * How long after a read first names a newcomer of the opponent's a bench card's tap waits, in milliseconds: until the
 * newcomer has flown in, under `Go, Dragonite!` across the field, through which the game drops the tap. Recorded in GO
 * Battle League on both phones, the banner was last drawn 2.0s after the HUD first named Magmar, Kyurem and Garchomp,
 * 1.9s after Articuno, and 1.5s after Dragonite, our charged move hiding the HUD until then: the game master's
 * three-turn `flyinDurationTurns`, 1.5s, shown half a second after the HUD changes. The read names the newcomer no
 * sooner than the HUD does. Both counters tapped the moment the newcomer was read went in under the banner, and did
 * nothing.
 */
const FLY_IN_MS = 2_000;

/**
 * How long after a switch of ours another to bank energy is not tried, and a tap refused is taken as the switch timer's
 * rather than dropped, in milliseconds: our switch timer, which is not read off the screen, and a tap it refuses costs
 * the turn it is made in. The game master's `quickSwapCooldownDurationSeconds` is 45. Live, the bench's cards were
 * still half dark with it 40s after a switch, so it may stand still through charged moves; a timer running longer has
 * its refusal taken as a dropped tap, tried once more at the cost of a turn, after which `REFUSED_MS` more go by.
 */
const TIMER_MS = 45_000;

/**
 * How long after the switch timer refused a switch of ours, or a second tap was dropped against the same newcomer,
 * another to bank energy is not tried, in milliseconds.
 */
const REFUSED_MS = 10_000;

/** Energy of ours on the bench: the charged moves lit as it left the field, and the Pokémon as then read. */
interface Bank {
  moves: string[];
  own: Side;
}

/** A switch of ours decided on: where its bench card is, and whether it is to draw a shield. */
export type Chosen = Switch & { at: Point; strip: boolean };

/**
 * A switch of ours tapped, as `judge` finds it: `early` where the read began too soon after the tap to tell, the next
 * being due at `due`; `took` where ours went in; and `refused` where the one tapped away from is still out, `from`, with
 * the stages it had.
 */
export type Judged =
  { kind: 'early'; due: number } | { kind: 'took' } | { kind: 'refused'; from: number; stages: Stages } | undefined;

/** The battle as one frame shows it, which a switch of ours is decided by. */
export interface Field {
  now: number;
  party: readonly Card[];
  fainted: ReadonlySet<number>;
  facing: Matchup;
  hp: Health;
  shields: { ours: number; theirs: number };
  stages: StagePair;
  fighting: boolean;
  anchored: boolean;

  /** The frame's size, which the bench's cards are placed on. */
  screen: Size;

  /** The slot of ours out, where it is known. */
  slot: number | undefined;

  /** The league's CP cap, `undefined` while it is unread. */
  cap: number | null | undefined;

  /** Our charged moves as the HUD's labels name them, by their buttons' x, and the buttons lit. */
  moves: ReadonlyMap<number, string>;
  lit: readonly number[];

  /** The button to throw, if any, whether a lit one finishes the opponent, and whether one is to be thrown now. */
  best: number | undefined;
  finish: boolean;
  throwing: boolean;

  /** Whether a throw of ours is tapped and not yet played, and whether ours throws its last hit. */
  pending: boolean;
  lastHit: boolean;

  /** The opponent's energy as counted, what it can afford, and the charged moves its banner has named. */
  estimate: Estimate | null;
  affordable: number | undefined;
  seen: ReadonlySet<string> | undefined;
}

export class Bench {
  readonly #data: GameData;
  readonly #meta: Meta | null | undefined;
  readonly #log: Reporter['event'];

  // Whether the opponent's switch just read is still to be answered, and the switch of ours chosen, tapped on the first
  // frame `Player` lets a bench card be once the opponent's newcomer has flown in, at `landing`: a counter to the
  // opponent's switch, or a switch to bank energy, `strip` where it is to draw a shield. Once tapped, the switch is
  // checked by the first read `SWITCHED_MS` on to name ours, or failing that to read its CP: the one tapped away from
  // still out is the tap refused, which leaves it out. And whether a tap has been dropped since the newcomer came in.
  #answer = false;
  #chosen: Chosen | undefined;
  #landing = -Infinity;
  #dropped = false;

  // Whether the opponent out came in by a switch rather than after a faint, and so has its switch timer to run before
  // it can switch away from ours; and the opponent ours last stayed in against, doomed, rather than switch from.
  #switchedIn = false;
  #stayedFor: string | null = null;
  #switching:
    | {
        from: number;
        slot: number;
        to: string;
        cp: number | null;
        at: number;
        stages: Stages;

        /** What the slot switched to had banked, given back to it where the switch is refused. */
        bank: Bank | undefined;

        /** The slot sent in to draw a shield before this switch, still out where the switch is refused. */
        stripping: number | undefined;

        /** How soon another switch to bank energy could be tried before this one, again so where its tap is dropped. */
        calm: number;
      }
    | undefined;

  // The energy each of ours left the field with by a switch, as the charged moves lit as it went, and the Pokémon as it
  // was then read, which a finish is judged by: it keeps the energy on the bench, and throws as it comes back in. The
  // slot sent in to draw a shield with its own, which is not switched away again to draw another. And how soon another
  // switch to bank energy may be tried, by our switch timer and its refusals, and when a switch of ours last went
  // through, which alone starts the timer: a tap refused more than `TIMER_MS` after one, or with none, is taken as
  // dropped.
  readonly #banked = new Map<number, Bank>();
  #stripping: number | undefined;
  #calmAt = -Infinity;
  #swappedAt = -Infinity;

  constructor(data: GameData, meta: Meta | null | undefined, log: Reporter['event']) {
    this.#data = data;
    this.#meta = meta;
    this.#log = log;
  }

  /** The switch of ours decided on, if one is. */
  get chosen(): Readonly<Chosen> | undefined {
    return this.#chosen;
  }

  /** Whether a switch of ours is under way: tapped, and not yet seen to go through or be refused. */
  get switching(): boolean {
    return this.#switching !== undefined;
  }

  /** Whether the switch decided on waits at `now` for the opponent's newcomer to fly in, nothing thrown meanwhile. */
  flying(now: number): boolean {
    return this.#chosen !== undefined && now < this.#landing;
  }

  /** Forgets the switch decided on, ours out having changed under it. */
  forget(): void {
    this.#chosen = undefined;
  }

  /** The opponent sent in a newcomer, first read at `at`: by a switch, or after a faint. */
  newcomer(at: number, switched: boolean): void {
    this.#answer = switched;
    this.#switchedIn = switched;
    this.#chosen = undefined;
    this.#landing = at + FLY_IN_MS;
    this.#dropped = false;
  }

  /**
   * The switch under way judged by our HUD as a read begun at `at` shows it, at `now`: by which of the two it names,
   * where it names either and they differ, before our CP. Palkia's `CP 4673` read as `CP 44673`, and so as no CP at
   * all, for 16s after its switch was dropped, its name read throughout. Undefined where nothing is under way, or the
   * read tells neither.
   */
  judge(
    { own, ownCp }: { own: string | null; ownCp: number | null },
    at: number,
    party: readonly Card[],
    now: number,
  ): Judged {
    const switching = this.#switching;

    if (!switching) {
      return undefined;
    }

    if (at - switching.at < SWITCHED_MS) {
      return { kind: 'early', due: switching.at + SWITCHED_MS };
    }

    const was = party[switching.from]?.species;
    const byName = own !== null && was !== switching.to && (own === was || own === switching.to);
    const stayed = byName ? own === was : ownCp === null ? undefined : ownCp === switching.cp;

    if (stayed === undefined) {
      return undefined;
    }

    this.#switching = undefined;

    if (!stayed) {
      this.#swappedAt = switching.at;
      return { kind: 'took' };
    }

    this.#banked.delete(switching.from);
    this.#stripping = switching.stripping;

    if (switching.bank) {
      this.#banked.set(switching.slot, switching.bank);
    }

    // Refused by the timer, the next switch to bank energy waits `REFUSED_MS`, as it does after a second tap dropped
    // against the same newcomer, something besides its flying in being in the way. The first dropped, the switch is
    // decided again as though never tapped, an opponent switched in answered afresh.
    const timer = switching.at - this.#swappedAt < TIMER_MS;
    const retry = !timer && !this.#dropped;

    this.#dropped ||= !timer;
    this.#calmAt = retry ? switching.calm : now + REFUSED_MS;
    this.#answer ||= retry && this.#switchedIn;
    this.#log(
      `${switching.to} not sent in`,
      'own',
      timer ? 'the switch timer is running' : `taken as dropped, no switch of ours in the last ${TIMER_MS / 1_000}s`,
    );

    return { kind: 'refused', from: switching.from, stages: switching.stages };
  }

  /**
   * Ours fainted, overtaking the switch under way, whatever the HUD shows next being the card sent in. Which of the two
   * fainted cannot be told, the CP that would say whether the switch took being cleared with the HUD, so neither is
   * trusted to have banked: the one switched from loses what the switch banked, which would have it sent back in to
   * finish if it was the one that fainted, and the one switched to gets back what it had. The switch timer is taken to
   * run from it, as it does if it took.
   */
  fainted(): void {
    if (this.#switching) {
      this.#swappedAt = this.#switching.at;
      this.#banked.delete(this.#switching.from);

      if (this.#switching.bank) {
        this.#banked.set(this.#switching.slot, this.#switching.bank);
      }
    }

    this.#switching = undefined;
  }

  /**
   * Which of ours to send in at a switch prompt, of those not `out`, by `nextOut`: a benched slot whose banked energy
   * finishes the opponent as it lands, as a lit move of the one out would, ahead of the rest.
   */
  next(field: Field, out: ReadonlySet<number>): Switch | undefined {
    const { cap } = field;
    const finishing = new Map(
      cap === undefined
        ? []
        : [...this.#banked].flatMap(([waiting, bank]) => {
            const moves = new Map(bank.moves.map((move, i) => [i, move]));
            const lands = finisher(
              this.#data,
              moves,
              moves.keys(),
              bank.own,
              field.facing.opponent,
              field.hp.opponent,
              field.shields.theirs,
              cap,
              { own: NO_STAGES, their: field.stages.their },
            );
            const move = lands && moves.get(lands.x);

            return move === undefined ? [] : [[waiting, move] as const];
          }),
    );

    return nextOut(this.#data, field.party, out, field.facing.opponent, this.#meta, finishing);
  }

  /** `slot` sent in at a switch prompt: its banked energy spent as it lands, and no slot drawing a shield any more. */
  sentIn(slot: number): void {
    this.#banked.delete(slot);
    this.#stripping = undefined;
  }

  /** Decides the switch of ours to make, if any, on a frame of the battle, which `chosen` then holds. */
  decide(field: Field): void {
    const data = this.#data;
    const meta = this.#meta;
    const { now, party, slot, fainted, facing, cap, hp, shields, stages, moves, lit, best, finish, fighting } = field;
    const { own: us, opponent: them } = facing;
    const theirName = them.species ?? 'the opponent';

    // Where a benched slot's card is, the bench's cards being the slots not fainted bar the one out, in party order.
    const benched = (chosen: Switch | undefined, strip: boolean) => {
      const measured =
        chosen && BENCH[[...party.keys()].filter((i) => i !== slot && !fainted.has(i)).indexOf(chosen.slot)];

      return chosen && measured && { ...chosen, at: place(measured, BENCH_ANCHOR, field.screen), strip };
    };

    // The moves lit, which a switch banks: the energy for each stays with ours on the bench.
    const banking = lit.flatMap((x) => moves.get(x) ?? []);

    // No shield of ours left, our HP read so low that a hit the opponent may land would faint us, the move to throw
    // lit and a shield of theirs to draw: the throw goes rather than any switch, there being little left of ours to
    // save. A faint feared rather than counted, unlike a throw for fear of fainting: an opponent switched in may carry
    // energy banked that the count, starting it at nothing, cannot see, and the counter and refuge switches answer just
    // such a one: so every move it is allowed, not only those the count affords, its banked energy unseen. Live, a
    // Zapdos threw two seconds after coming back in. But on a hit calculated, never on a guess for something unread,
    // bar their CP, which is taken as the cap as the shield takes it. And only where the move to throw is lit already,
    // so that staying in is a throw and not a swipe. Live, a Galarian Moltres at a tenth of its HP stayed in against a
    // Kyogre switched in, threw Fly into its last shield and fainted; Kyogre had none left for the battle.
    const aimed = best !== undefined && lit.includes(best) ? moves.get(best) : undefined;
    const feared =
      shields.ours === 0 && shields.theirs > 0 && aimed !== undefined && cap !== undefined
        ? wouldFaint(data, us, them, hp.own, cap, { meta, seen: field.seen, stages })
        : undefined;
    const doomed = feared !== undefined && feared.faints && feared.hardest !== undefined;

    // The opponent's switch answered once, on the first frame the bench is drawn for and again where its tap is
    // dropped, by a counter of ours where one is benched; and for as long as the newcomer stays out, its switch timer
    // spent, ours threatened by it banks a move lit by switching to one safe from it, whenever one lights. Neither
    // where a lit move would finish the newcomer, the bench tap going ahead of the throw, nor where ours is doomed,
    // which is logged once per opponent.
    const stay = (chosen: Switch | undefined) => {
      if (chosen && doomed) {
        if (this.#stayedFor !== theirName) {
          this.#stayedFor = theirName;
          this.#log(
            `staying in against ${theirName}`,
            'own',
            `${aimed} drawn into a shield before ${us.species ?? 'ours'} faints`,
          );
        }

        return undefined;
      }

      return benched(chosen, false);
    };

    if (this.#answer && slot !== undefined && fighting && !this.#switching) {
      this.#answer = false;
      this.#chosen =
        finish || slot === this.#stripping ? undefined : stay(counterOf(data, party, slot, us, fainted, them, meta));
    }

    if (
      !this.#chosen &&
      !this.#switching &&
      !finish &&
      this.#switchedIn &&
      fighting &&
      banking.length > 0 &&
      slot !== undefined &&
      slot !== this.#stripping &&
      now >= this.#calmAt
    ) {
      this.#chosen = stay(refugeOf(data, party, slot, us, fainted, them, meta));
    }

    // A lit move that would finish the opponent but for its shield is kept, and a benched slot with energy banked
    // sent in to draw the shield: ours throws it once the shields are gone, sent back in after the one sent faints
    // where it took the last. Not from a slot sent in to draw one itself, which throws rather than switch away again,
    // nor while the switch timer may still be running from a switch it refused.
    if (
      !this.#chosen &&
      !this.#switching &&
      !doomed &&
      fighting &&
      slot !== undefined &&
      slot !== this.#stripping &&
      shields.theirs > 0 &&
      cap !== undefined &&
      now >= this.#calmAt
    ) {
      const blocked = finisher(data, moves, lit, us, them, hp.opponent, 0, cap, stages);
      const banked = new Map([...this.#banked].map(([waiting, bank]) => [waiting, bank.moves]));
      const chosen = blocked && stripperOf(data, party, slot, fainted, banked, them, meta);
      const held = blocked && moves.get(blocked.x);

      this.#chosen = benched(chosen && { ...chosen, why: `${chosen.why}; ${held ?? 'ours'} ${blocked.why}` }, true);
    }

    // While the opponent's count is anchored, ours switches to a benched Pokémon resisting the charged move of the
    // opponent's that hits it super effectively, one fast move before the count affords it: that fast move lands on
    // the newcomer, and so does the throw. Fired with shields or without, the switch costing the switch timer rather
    // than a shield, and whether or not ours is doomed, the hit it would faint to going to the newcomer instead. Not
    // where a lit move would finish the opponent, which goes instead, nor where one is to be thrown now, which goes
    // first, the fight standing still through a throw so that the opponent gains nothing meanwhile; a lit move held
    // for another is banked by the switch, as the refuge banks one. Not inside `TIMER_MS` of a switch of ours, as no
    // switch is, a faint starting no timer.
    const { estimate, affordable } = field;

    if (
      !this.#chosen &&
      !this.#switching &&
      !finish &&
      !field.pending &&
      !field.throwing &&
      fighting &&
      field.anchored &&
      slot !== undefined &&
      estimate &&
      affordable !== undefined &&
      now >= this.#calmAt
    ) {
      const chosen = resisterOf(data, party, slot, us, fainted, them, field.seen, meta);
      const due = chosen && affordable >= chosen.cost;

      this.#chosen = due
        ? benched({ ...chosen, why: `${chosen.move} affordable after one more ${estimate.fast}; ${chosen.why}` }, false)
        : undefined;
    }

    // Ours with its attack or defense dropped, by its own throw once it has played or by the opponent's that the
    // banner named, switches to a benched Pokémon safe from every move the opponent may hold, which clears the drop
    // and banks whatever is lit: ours comes back whole, its energy kept. Players in three of four championship finals
    // did so. Never into a Pokémon the opponent could farm energy off, so with none safe it stays in. It gives way to
    // whatever the other switches give way to: a lit move that would finish the opponent, a throw tapped and not yet
    // played, ours doomed, and our last hit, after which a drop no longer matters; and to the other switches
    // themselves, and our switch timer. Not from a slot sent in to draw a shield, which throws rather than switch away.
    if (
      !this.#chosen &&
      !this.#switching &&
      !finish &&
      !field.pending &&
      !field.lastHit &&
      fighting &&
      slot !== undefined &&
      slot !== this.#stripping &&
      now >= this.#calmAt
    ) {
      this.#chosen = stay(clearerOf(data, party, slot, us, stages.own, fainted, them, meta));
    }

    // A switch decided on while the opponent's newcomer flies in is tapped once it has, nothing thrown meanwhile: the
    // energy lit is the switch's to bank. Given up where a lit move comes to finish the newcomer, or ours comes to be
    // doomed, meanwhile, which none of the switches is decided on; doomed, it is told as staying in.
    if (this.#chosen && now < this.#landing && (finish || doomed)) {
      this.#chosen = doomed ? stay(this.#chosen) : undefined;
    }
  }

  /**
   * The bench card of the switch decided on tapped, on the frame of `field`: taken to have gone in until the HUD says
   * otherwise, banking what is lit for the one switched away from, and starting our switch timer. The switch is no
   * longer to be made, but judged.
   */
  tapped(field: Field): void {
    const chosen = this.#chosen;
    const from = field.slot;

    if (!chosen || from === undefined) {
      return;
    }

    const to = field.party[chosen.slot]?.species ?? '?';
    const banking = field.lit.flatMap((x) => field.moves.get(x) ?? []);
    const banks = banking.length > 0 ? `, banking ${banking.join(' and ')}` : '';

    this.#log(
      `switching to ${to} against ${field.facing.opponent.species ?? 'the opponent'}${banks}`,
      'own',
      chosen.why,
    );
    this.#switching = {
      from,
      slot: chosen.slot,
      to,
      cp: field.facing.own.cp,
      at: field.now,
      stages: field.stages.own,
      bank: this.#banked.get(chosen.slot),
      stripping: this.#stripping,
      calm: this.#calmAt,
    };
    this.#banked.delete(chosen.slot);
    this.#banked.set(from, { moves: banking, own: field.facing.own });
    this.#stripping = chosen.strip ? chosen.slot : undefined;
    this.#calmAt = field.now + TIMER_MS;
    this.#chosen = undefined;
  }
}
