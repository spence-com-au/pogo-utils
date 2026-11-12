/**
 * A sentence split on its backticks: prose at the even positions and the quoted characters at the odd ones, the string
 * having begun outside a pair.
 *
 * **An unpaired tick is prose rather than markup**, so the tail it opens is rejoined and left as text. A refusal from
 * `search/parse.js` quotes a token the reader typed, and a reader can type a tick — in a name, where the box splits on
 * commas and leaves everything else alone. Pairing from the left and giving up on the last one is what keeps that from
 * setting the rest of the refusal in `<code>`: `terms.test.js` holds the help table to pairs, and this holds the
 * strings that arrive from outside any table.
 */
export function spans(message: string): string[] {
  const parts = message.split('`');

  return parts.length % 2 === 0 ? [...parts.slice(0, -2), parts.slice(-2).join('`')] : parts;
}

/**
 * A sentence's backticked parts set in `<code>`, so that prose written in this repository's convention reads on screen
 * as code rather than showing its own punctuation: the Search page's refusals, category help and caveats, and the
 * phone note's errors, such as the `adb kill-server` a busy phone asks for.
 */
export const ticked = (message: string) =>
  spans(message).map((part, index) => (index % 2 === 0 ? part : <code key={index}>{part}</code>));
