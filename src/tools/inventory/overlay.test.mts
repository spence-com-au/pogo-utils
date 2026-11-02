/**
 * What `assembled` answers and what it refuses, which is the one reader that returns a triple no pass read and so the
 * one whose refusals are worth as much as its answers.
 *
 * `screens.test.mts` cannot state them. Four of its 43 captures hand `assembled` a reading, it answers on two of those
 * and changes the answer on one — and on `dialga-origin.png`, the other it answers, the combination that checks out is
 * the one the first pass read anyway, so the row is satisfied either way and nothing there distinguishes an assembly
 * from the fallback. What no capture reaches at all is two combinations checking out, and the single-digit percentage
 * below is a screen nobody has captured.
 *
 * The readings are quoted off the real loop, dumped out of `readOverlay` over every fixture, rather than invented. What
 * keeps them from going stale as transcription is the corpus itself: a treatment that starts reading those bands
 * differently moves the triple `articuno-galar.png`'s row denies, and `screens.test.mts` fails there.
 */

import { assembled, confirmed, fuller } from './overlay.mts';
import { expect, test } from 'vitest';

/**
 * The two captures this answers, as the readings the real loop hands it. `articuno-galar.png` is the case the feature
 * exists for — attack 10 or 12, stamina 13 or 3, and only `12/4/13` coming to the `64` the second pass printed.
 *
 * `dialga-origin.png` is the one the corpus cannot speak for: the second pass loses the stamina alone, so the only
 * combination that checks out is the first pass's own `10/13/13` and the answer is the fallback's. Asserted anyway,
 * because "the fallback would have done" is a fact about these two readings rather than about the code — a change that
 * started answering something else here would pass every row in the corpus.
 */
test('the two captures this answers assemble to what their screens read', () => {
  expect(
    assembled([
      { iv: { attack: 10, defense: 4, stamina: 13 }, before: '20 ' },
      { iv: { attack: 12, defense: 4, stamina: 3 }, before: '120 164 ' },
    ]),
    'the triple no pass read on `articuno-galar.png` is no longer the one the percentage picks out',
  ).toStrictEqual({ attack: 12, defense: 4, stamina: 13 });

  expect(
    assembled([
      { iv: { attack: 10, defense: 13, stamina: 13 }, before: 'L251 ' },
      { iv: { attack: 10, defense: 13, stamina: 1 }, before: '/ 25 180 ' },
    ]),
    '`dialga-origin.png` assembles to something other than the triple its first pass read',
  ).toStrictEqual({ attack: 10, defense: 13, stamina: 13 });
});

/**
 * Nothing where nothing checks out, which is the common case and the one that leaves `readOverlay` standing on its
 * fallback. Both are readings the loop really hands this: `rotom-wash.png`'s two passes agree on `13/3/1` and neither
 * prints a percentage that comes to it, and `burmy-plant.png` offers a single pass whose `45` is no percentage of
 * `14/15/15`.
 */
test('nothing is assembled where no combination checks out', () => {
  expect(
    assembled([
      { iv: { attack: 13, defense: 3, stamina: 1 }, before: 'L12 3/ ' },
      { iv: { attack: 13, defense: 3, stamina: 1 }, before: 'L12 13/ ' },
    ]),
  ).toBeNull();

  expect(assembled([{ iv: { attack: 14, defense: 15, stamina: 15 }, before: '45 ' }])).toBeNull();

  // And with no reading at all, which is every capture whose band reads as no possible triple — `readOverlay` asks
  // this before it knows whether it has anything to fall back on.
  expect(assembled([])).toBeNull();
});

/**
 * Nothing where more than one combination checks out, which is the abstention the corpus cannot reach: no capture in it
 * puts two triples in play with a percentage apiece. These are `articuno-galar.png`'s own readings with a percentage
 * printed on both passes, disagreeing — `160` confirming the `10/4/13` near-white read and `164` the `12/4/13` it did
 * not. Two is a guess between them rather than a reading, so this answers nothing and the fallback stands.
 */
test('nothing is assembled where more than one combination checks out', () => {
  expect(
    assembled([
      { iv: { attack: 10, defense: 4, stamina: 13 }, before: '160 ' },
      { iv: { attack: 12, defense: 4, stamina: 3 }, before: '164 ' },
    ]),
  ).toBeNull();

  // Which is how an appended treatment can cost an answer, and what `OVERLAY_TREATMENTS` says about the safety of
  // adding one rests on: `articuno-galar.png`'s two real readings with a third that reads the near-white triple and
  // prints a percentage for it. The assembly it had is gone, so the fallback stands and that is the triple its row
  // denies. Here rather than only in the prose, because a paragraph is what someone reads before appending a pass.
  expect(
    assembled([
      { iv: { attack: 10, defense: 4, stamina: 13 }, before: '20 ' },
      { iv: { attack: 12, defense: 4, stamina: 3 }, before: '120 164 ' },
      { iv: { attack: 10, defense: 4, stamina: 13 }, before: '160 ' },
    ]),
    'a third pass no longer costs the assembly `articuno-galar.png` depends on, so the docblock above overstates it',
  ).toBeNull();
});

/**
 * A percentage of one digit confirms nothing, which is what stops this inventing a triple off a run that is no
 * percentage at all. Both readings here are ordinary: a level of 20 ends in the `0` that a triple summing to 0 comes
 * to, and `182` ends in the `2` that one summing to 1 does, and either run is longer than that single digit — so
 * without the two-digit floor `0/0/0` is uniquely "confirmed" and displaces the `0/4/13` the first pass actually read.
 *
 * Both a level run and a plain one, because that is what separates the floor from guarding on `lastIsLevel`: the `L`
 * rules out the first of these and says nothing about the second.
 */
test('a percentage of one digit assembles nothing', () => {
  expect(
    assembled([
      { iv: { attack: 0, defense: 4, stamina: 13 }, before: 'L20 ' },
      { iv: { attack: 12, defense: 0, stamina: 0 }, before: '182 ' },
    ]),
    'a level of 20 confirmed a triple summing to 0, which no pass read',
  ).toBeNull();

  expect(
    assembled([
      { iv: { attack: 0, defense: 4, stamina: 13 }, before: '180 ' },
      { iv: { attack: 12, defense: 0, stamina: 0 }, before: '182 ' },
    ]),
    'a run of `180` confirmed a triple summing to 0, which no pass read',
  ).toBeNull();
});

/**
 * And what the floor refuses outright, which is the part of it `assembled` cannot show: the triples it turns down are
 * turned down even where their percentage is printed as a run of its own, so they lose a `chosen` and not only an
 * assembly. Every triple summing under 5 has a one-digit percentage, and before the floor all 35 of them could confirm
 * themselves off that digit.
 *
 * Derived from the percentage the file documents rather than listed, so a floor written as something narrower — the
 * digit having to be borrowed from a longer run, say — fails here rather than passing on the cases that were quoted.
 */
test('a triple summing under 5 confirms nothing, its percentage being one digit', () => {
  const percentageOf = ({ attack, defense, stamina }: { attack: number; defense: number; stamina: number }) =>
    String(Math.floor(((attack + defense + stamina) / 45) * 100));
  const sub5 = [];

  for (let attack = 0; attack <= 15; attack += 1) {
    for (let defense = 0; defense <= 15; defense += 1) {
      for (let stamina = 0; stamina <= 15; stamina += 1) {
        const iv = { attack, defense, stamina };

        if (percentageOf(iv).length < 2) {
          sub5.push(iv);
        }
      }
    }
  }

  // The count as well as the refusals, because an empty list of offenders is also what an enumeration that selected
  // nothing produces, and that reads exactly like a pass.
  expect(sub5.length, 'the triples with a one-digit percentage are no longer the 35 summing under 5').toBe(35);
  expect(
    sub5.filter((iv) => confirmed(`L20 ${percentageOf(iv)} `, iv)),
    'a triple summing under 5 confirms itself off a single printed digit',
  ).toStrictEqual([]);

  // The control, or the assertion above would also pass on a `confirmed` that had stopped reading a percentage printed
  // as its own run at all: the same line with two digits of percentage still confirms.
  expect(confirmed('L20 91 ', { attack: 14, defense: 13, stamina: 14 })).toBe(true);
});

/**
 * What the fallback prefers where the percentage settles nothing: a later reading holding every digit the first one
 * read and more, near-white being the pass that clips thin `1`s. A Skarmory whose overlay reads `11/10/11` came back
 * `1/1/1` off the first pass, and that is a triple nothing about it marks as wrong.
 */
test('a reading that lost digits gives way to one holding them', () => {
  expect(
    fuller([{ iv: { attack: 1, defense: 1, stamina: 1 } }, { iv: { attack: 11, defense: 10, stamina: 11 } }]),
  ).toStrictEqual({ attack: 11, defense: 10, stamina: 11 });

  // Partly, too: a pass that recovered one field but not the others still holds the first pass's digits.
  expect(
    fuller([{ iv: { attack: 1, defense: 1, stamina: 1 } }, { iv: { attack: 11, defense: 1, stamina: 1 } }]),
  ).toStrictEqual({ attack: 11, defense: 1, stamina: 1 });
});

/**
 * Nothing where no later reading extends the first. `articuno-galar.png`'s `12/4/3` is not `10/4/13` with digits added,
 * and `dialga-origin.png`'s second pass lost a digit the first kept, so both stand on the fallback as they did.
 */
test('a reading that only differs, or lost more, is no fuller', () => {
  expect(
    fuller([{ iv: { attack: 10, defense: 4, stamina: 13 } }, { iv: { attack: 12, defense: 4, stamina: 3 } }]),
  ).toBeNull();

  expect(
    fuller([{ iv: { attack: 10, defense: 13, stamina: 13 } }, { iv: { attack: 10, defense: 13, stamina: 1 } }]),
  ).toBeNull();

  expect(fuller([{ iv: { attack: 13, defense: 3, stamina: 1 } }])).toBeNull();
  expect(fuller([])).toBeNull();
});

/** Nothing where two different readings extend it as far, that being a guess between them. */
test('two readings extending it as far are a guess', () => {
  expect(
    fuller([
      { iv: { attack: 1, defense: 1, stamina: 1 } },
      { iv: { attack: 11, defense: 1, stamina: 1 } },
      { iv: { attack: 1, defense: 10, stamina: 1 } },
    ]),
  ).toBeNull();
});
