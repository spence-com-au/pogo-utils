import { expect, test } from 'vitest';
import { OptionError, readOptions, type Asked } from './options.mts';

test('reads Training, with its leader and league, until stopped where no count is given', () => {
  expect(readOptions({ leader: 'spark', league: 'great' })).toEqual({
    mode: { mode: 'training', leader: 'spark', league: 'great' },
    count: Infinity,
  });
});

test('reads GO Battle League by any league’s name and a party, trimmed, and a count', () => {
  expect(readOptions({ mode: 'gbl', league: ' fantasy cup ', party: ' GBL ', count: '3' })).toEqual({
    mode: { mode: 'gbl', league: 'fantasy cup', party: 'GBL' },
    count: 3,
  });
});

test.each<[Asked, keyof Asked, string]>([
  [{ league: 'great' }, 'leader', 'takes one of blanche, candela, spark'],
  [{ leader: 'arlo', league: 'great' }, 'leader', 'takes one of blanche, candela, spark'],
  [{ leader: 'spark', league: 'fantasy cup' }, 'league', 'takes one of great, ultra, master'],
  [{ mode: 'rocket' }, 'mode', 'takes one of training, gbl'],
  [{ mode: 'gbl', league: ' ' }, 'league', 'is needed for GO Battle League, as ultra or fantasy cup'],
  [{ mode: 'gbl', league: 'ultra', party: '' }, 'party', 'takes the name of a party saved for the league'],
  [{ mode: 'gbl', league: 'ultra', leader: 'spark' }, 'leader', 'is for training; GO Battle League has no leader'],
  [
    { leader: 'spark', league: 'great', party: 'GBL' },
    'party',
    'is for GO Battle League; Training battles with the recommended party',
  ],
  [{ leader: 'spark', league: 'great', count: '0' }, 'count', 'takes a whole number of battles, 1 or more'],
  [{ leader: 'spark', league: 'great', count: '2.5' }, 'count', 'takes a whole number of battles, 1 or more'],
  [{ leader: 'spark', league: 'great', count: '' }, 'count', 'takes a whole number of battles, 1 or more'],
])('refuses %j, naming the option at fault and what is wrong with it', (asked, option, says) => {
  const refusal = (() => {
    try {
      readOptions(asked);
    } catch (error) {
      return error;
    }
  })();

  expect(refusal).toBeInstanceOf(OptionError);
  expect(refusal).toMatchObject({ option, says, message: `--${option} ${says}` });
});
