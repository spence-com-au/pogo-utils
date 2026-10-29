/**
 * What a run is asked to play, read out of what was typed: `pnpm battle run`'s flags, or the Battle tab's form, which
 * names its fields as the flags are named so that the two are held to the same rules and refused in the same words.
 */

import { LEADERS, LEAGUES, type Mode } from './menus.mts';

/** Each option as typed, absent where it was not: a flag not passed, or a field the form leaves out. */
export interface Asked {
  mode?: string;
  leader?: string;
  league?: string;
  party?: string;
  count?: string;
}

/**
 * Why an option was refused: `option` the one at fault, and `says` what is wrong with it, which reads after the
 * option's name — `--count` on the command line, the field's label on the page.
 */
export class OptionError extends Error {
  readonly option: keyof Asked;
  readonly says: string;

  constructor(option: keyof Asked, says: string) {
    super(`--${option} ${says}`);
    this.option = option;
    this.says = says;
  }
}

function oneOf<T extends string>(option: keyof Asked, value: string | undefined, allowed: readonly T[]): T {
  const found = allowed.find((one) => one === value);

  if (found === undefined) {
    throw new OptionError(option, `takes one of ${allowed.join(', ')}`);
  }

  return found;
}

/**
 * The battles `asked` names and how many of them, `Infinity` where no count is given, or an `OptionError` for the first
 * option that cannot be played: Training takes a leader and one of its three leagues, GO Battle League the name of any
 * league on now and, if wanted, a party saved for it, and neither takes the other's.
 */
export function readOptions(asked: Asked): { mode: Mode; count: number } {
  const mode: Mode =
    oneOf('mode', asked.mode ?? 'training', ['training', 'gbl']) === 'training'
      ? {
          mode: 'training',
          leader: oneOf('leader', asked.leader, LEADERS),
          league: oneOf('league', asked.league, LEAGUES),
        }
      : {
          mode: 'gbl',
          league: required('league', asked.league, 'is needed for GO Battle League, as ultra or fantasy cup'),
          ...(asked.party !== undefined && {
            party: required('party', asked.party, 'takes the name of a party saved for the league'),
          }),
        };

  if (mode.mode === 'gbl' && asked.leader !== undefined) {
    throw new OptionError('leader', 'is for training; GO Battle League has no leader');
  }

  if (mode.mode === 'training' && asked.party !== undefined) {
    throw new OptionError('party', 'is for GO Battle League; Training battles with the recommended party');
  }

  const count = asked.count === undefined ? Infinity : Number(asked.count);

  if (count !== Infinity && (!Number.isInteger(count) || count < 1)) {
    throw new OptionError('count', 'takes a whole number of battles, 1 or more');
  }

  return { mode, count };
}

/** `value` trimmed, or `says` where nothing is left of it. */
function required(option: keyof Asked, value: string | undefined, says: string): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new OptionError(option, says);
  }

  return trimmed;
}
