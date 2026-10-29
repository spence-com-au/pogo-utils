/**
 * What `run` tells of itself: each `event` something done once, as a tap or a battle's start, and its `status`, how the
 * run and the battle stand, sent again on every frame. Apart from `report.mts`, which draws them into a terminal, so
 * that the battle's Worker can send them to a page and the page can draw them.
 */

import { type Tally } from './run.mts';

/** One side of the battle as last read, `null` for what has not been. */
export interface Side {
  species: string | null;
  cp: number | null;
  hp: number | null;
  shields: number;

  /** How many of its party are left able to battle, as its Poké Balls show, or null where they have not been read. */
  left: number | null;
}

/** How many Pokémon each side brings to a battle. */
export const PARTY = 3;

/** The battle under way, or the last one played, and what is to be done in it. */
export interface Fight {
  own: Side;
  opponent: Side;

  /** Our charged moves' names, read under their buttons. */
  moves: readonly string[];

  /** The charged move to be thrown, or `undefined` for whichever lights first. */
  throwing: string | undefined;
  bait: boolean;
  shield: boolean;

  /** The opponent's energy as counted off our bar, and the fast move it is counted by, where it can be counted. */
  energy?: { energy: number; fast: string };
}

export interface Status {
  /** Battles finished, and how many are to be. */
  battles: number;
  count: number;

  /** What the screen was last recognised as: a battle's state, a menu, or `other`. */
  screen: string;

  /** How long nothing may still go unrecognised before the run stops, in milliseconds, and how long in all. */
  lostIn: number;
  lostAfter: number;
  fight: Fight | undefined;
}

export interface Reporter {
  /**
   * Something done once: by one `side`, or by the run where none is given, as a battle's start or a menu's tap. `why`
   * is the reasoning behind it, where there is any, which is told after it but drawn as less to read.
   */
  event(line: string, side?: 'own' | 'opponent', why?: string): void;
  status(status: Status): void;
}

/** The opponent's energy as counted, `40 by Counter`. */
export const energyOf = ({ energy, fast }: NonNullable<Fight['energy']>) => `${energy} by ${fast}`;

/** How long nothing must go unrecognised before the panel counts down to the run's stopping, in milliseconds. */
const QUIET_MS = 1_000;

/** How the run stands, for the line above the table. */
export function summary(status: Status | undefined): string {
  const { battles, count, screen, lostIn, lostAfter } = status ?? {};
  const finished = `${battles ?? 0}${count === undefined || count === Infinity ? '' : ` of ${count}`} finished`;
  const quiet = lostIn !== undefined && lostAfter !== undefined && lostAfter - lostIn >= QUIET_MS;
  const lost = quiet ? `, stopping in ${Math.ceil(Math.max(0, lostIn) / 1000)}s` : '';

  return `${finished}; ${screen ?? 'starting'}${lost}`;
}

/**
 * What a run that ended on its own did, as the lines to tell it in: how many battles finished and how they went, and,
 * where fewer than `count` did, why it stopped short.
 */
export function ending({ battles, won, lost }: Tally, count: number): string[] {
  const unread = battles - won - lost;
  const outcomes = [`${won} won`, `${lost} lost`, ...(unread > 0 ? [`${unread} unread`] : [])];
  const tally = `${outcomes.slice(0, -1).join(', ')} and ${outcomes.at(-1)}`;

  return [
    `${battles} battle${battles === 1 ? '' : 's'} finished: ${tally}`,
    ...(battles < count ? ['GO Battle League has no battle to offer until its reward is collected'] : []),
  ];
}
