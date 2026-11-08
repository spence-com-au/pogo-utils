/**
 * What `bestOf` reads and what it keeps, which is the decision `scripts/inventory.mts` makes about every Pokémon it
 * walks past. `phone.test.mts` drives the whole script against a phone of recordings, which says what a scan wrote and
 * not how many looks at a screen it took to get there, and `parse` in `cli.test.mts` reads a file once and retries
 * nothing.
 *
 * So the scan's half of the contract is asserted here, against answers scripted as the fault scores a reading comes
 * out with — a screen read whole scoring nought, and each thing wrong with it raising the score. Which facts about a
 * reading count belongs with the scan, and which captures come out above nought is pinned over the real corpus in
 * `screens.test.mts`; how those facts rank against each other is `faultsOf`, asserted at the foot of this file. This
 * is the behaviour those leave unstated: that a score above nought is read again, that a score of nought is not, and
 * which of several answers comes back.
 *
 * `read` records the attempts it was handed throughout, so that how many times it was called is asserted alongside what
 * came back. An answer alone cannot say it: `bestOf` returning the clean answer is also what a reader called once and
 * lucky would produce.
 */

import { bestOf, faultsOf } from './attempts.mts';
import { expect, test } from 'vitest';

/** How many faults each attempt's answer comes out with, in order, and the attempt numbers `read` was handed. */
function reader(...counts: readonly number[]) {
  const asked: number[] = [];

  return {
    asked,

    // The answer is its own count wrapped in an object, so that `toBe` below is an identity test: two attempts of one
    // quality are the same number and `toBe` on the number alone could not say which of them came back.
    read: (attempt: number) => {
      asked.push(attempt);

      return Promise.resolve({ faults: counts[attempt] ?? 0 });
    },
  };
}

const faults = (answer: { faults: number }) => answer.faults;

test('an answer nothing counts against is taken at once', async () => {
  const { asked, read } = reader(0, 0, 0);

  expect(await bestOf(3, faults, read)).toStrictEqual({ faults: 0 });
  expect(asked, 'a faultless answer was read again, which costs a screenshot and an OCR run for nothing').toStrictEqual(
    [0],
  );
});

/**
 * The retry itself: a reading with something counting against it is read again, and the clean second look is what comes
 * back. This is the whole point of the loop — the first answer is the one the scan used to write into a row, notes and
 * all, while it still had the phone on that Pokémon.
 */
test('a faulty answer is read again, and the clean second look is what comes back', async () => {
  const { asked, read } = reader(1, 0);

  expect(await bestOf(3, faults, read)).toStrictEqual({ faults: 0 });

  // Two, not three: the clean answer stops the loop as surely as a clean first one does, so a Pokémon that reads
  // whole on the second look costs one extra read rather than the whole ration.
  expect(asked).toStrictEqual([0, 1]);
});

/**
 * And the half a retry is easy to leave out. A second look can come back worse than the first — on a detail screen,
 * one whose HP goes unread has no key at all, and three keyless readings in a row stop the pass — so the answer kept
 * is the one with least counting against it rather than whichever the last attempt produced.
 */
test('the best of the attempts comes back, not the last', async () => {
  const { asked, read } = reader(2, 1, 3);
  const answer = await bestOf(3, faults, read);

  expect(answer).toStrictEqual({ faults: 1 });
  expect(asked, 'the ration was not spent, so the answer returned was not the best available').toStrictEqual([0, 1, 2]);
});

/**
 * Equals go to the last, which is what leaves the ordinary run — every attempt as doubtful as the one before — handing
 * back exactly what it always did. It reaches no further than equals, which is why the scan keeps the last screenshot
 * for itself rather than taking the one travelling with the reading.
 */
test('the last of equal answers comes back', async () => {
  const { read } = reader(1, 1, 1);
  const answers: { faults: number }[] = [];
  const kept = await bestOf(3, faults, async (attempt) => {
    const answer = await read(attempt);
    answers.push(answer);

    return answer;
  });

  expect(kept).toBe(answers[2]);
});

test('the ration bounds the reads where no attempt is clean', async () => {
  const { asked, read } = reader(1, 1, 1, 1, 1);

  expect(await bestOf(3, faults, read)).toStrictEqual({ faults: 1 });
  expect(asked).toStrictEqual([0, 1, 2]);
});

/**
 * A ration of nought or less still reads once, which is the one input that could hang this rather than answer wrongly:
 * the loop has no answer to give until `read` has produced one, so there is nothing for it to return early. Asserted
 * because a caller computing its ration — `READ_ATTEMPTS` less what a pass has spent, say — can arrive here with one.
 */
test.for([0, -1])('a ration of %i still reads once', async (tries) => {
  const { asked, read } = reader(1);

  expect(await bestOf(tries, faults, read)).toStrictEqual({ faults: 1 });
  expect(asked).toStrictEqual([0]);
});

/**
 * The other half of the scan's contract, and the one a sum gets wrong. The scan ranks a reading in three tiers — no
 * key, then the overlay and the form, then the notes — and each pair of them has a reachable case where a sum picks the
 * worse reading. Summed, one lost field weighed the same as one note: a screen whose HP went unread scored two where
 * one read whole with two notes scored two as well, and last-of-equals handed back the keyless one. Summed within the
 * fields, a reading that lost the HP alone ties one that read it and lost the overlay and the form, and the tie again
 * goes to the keyless reading — which is the one `walk` counts as a miss and writes `detail screen not read`, three in
 * a row stopping the pass, where the other answers a row with the HP, weight, height and name on it.
 *
 * `99` rather than two or three, because the claim is that no count in a lower tier reaches one above it: a ceiling
 * written into the weighting would pass at the counts `identify` happens to raise today and fail on the next one added.
 */
test('a tier outranks every count in the tiers below it', () => {
  expect(faultsOf(0, 99, 99)).toBeLessThan(faultsOf(1, 0, 0));
  expect(faultsOf(0, 0, 99)).toBeLessThan(faultsOf(0, 1, 0));
  expect(faultsOf(1, 99, 99)).toBeLessThan(faultsOf(2, 0, 0));
});

/** And each tier still orders readings that tie above it, or the retry would have nothing to prefer. */
test('counts order within a tier, and only a reading with nothing wrong scores zero', () => {
  expect(faultsOf(0, 0, 1)).toBeLessThan(faultsOf(0, 0, 2));
  expect(faultsOf(0, 0, 2)).toBeLessThan(faultsOf(0, 0, 3));
  expect(faultsOf(0, 1, 0)).toBeLessThan(faultsOf(0, 2, 0));
  expect(faultsOf(0, 0, 0)).toBe(0);

  // Nought is what `bestOf` stops on, so every tier has to keep a score above it or that reading is never read again.
  expect(faultsOf(0, 0, 1)).toBeGreaterThan(0);
  expect(faultsOf(0, 1, 0)).toBeGreaterThan(0);
  expect(faultsOf(1, 0, 0)).toBeGreaterThan(0);
});
