/**
 * The prose convention `ticked` draws, as a claim about a string rather than a render. `help` in `search/terms.js` is
 * prose this repository authors, and `terms.test.js` holds it to balanced ticks; a refusal from `search/parse.js`
 * quotes a token the reader typed, which no table can hold. So this is the other half of that invariant, taken from the
 * side this repository does not get to author.
 */

import { expect, test } from 'vitest';

import { read } from './search/parse.js';
import { spans } from './ticked.js';

/**
 * Both halves of what `spans` promises, for any message at all: an odd number of pieces, so the last one is prose and
 * every `<code>` the sentence opened is one it closed; and a join on the tick that gives the message back, so nothing
 * has been dropped or merged away on the way.
 */
const faithful = (message: string) => ({
  message,
  prose: spans(message).length % 2 === 1,
  joined: spans(message).join('`'),
});

const kept = (message: string) => ({ message, prose: true, joined: message });

test('a sentence is split on its backtick pairs', () => {
  expect(spans('the game has no `gen1`')).toEqual(['the game has no ', 'gen1', '']);
  expect(spans('`a` and `b`')).toEqual(['', 'a', ' and ', 'b', '']);
  expect(spans('no ticks at all')).toEqual(['no ticks at all']);
});

test('an unpaired tick leaves the sentence prose rather than opening a span it cannot close', () => {
  for (const message of ['a`b', '`', '``', 'a `b` c', 'a `b` c`', '`a`b`c`', '']) {
    expect(faithful(message)).toEqual(kept(message));
  }
});

test('a refusal quoting a tick the reader typed keeps it, and keeps the rest of the sentence prose', () => {
  /*
   * The reachable case: a name holding a tick, the box splitting on commas and leaving everything else alone, so the
   * token this refusal quotes is the reader's own text. Seven ticks cannot be paired — before this, the stray one
   * vanished off the page and the tail of the refusal was handed to `<code>`.
   */
  const refusal = read('(shiny)`a').error ?? '';

  expect([...refusal].filter((character) => character === '`')).toHaveLength(7);
  expect(faithful(refusal)).toEqual(kept(refusal));

  // The tick is still there to be read, in the prose at the end rather than swallowed as a delimiter.
  expect(spans(refusal).at(-1)).toBe('a`');
});
