/**
 * Deciding whether a headline is about a named event: the words each side is reduced to, and how much of one the other
 * already says.
 */

// Words too common across Pokémon GO event names to carry any matching signal: every second name contains "Pokémon GO"
// or "event", so counting them inflates every score equally and separates nothing.
const STOPWORDS = new Set(['a', 'and', 'during', 'for', 'go', 'in', 'of', 'pokemon', 'the', 'to', 'with']);

/**
 * The comparable words of a name, slug or headline.
 *
 * Accents are folded because the feed writes `Pokémon` where a slug writes `pokemon`; `_` and `-` are separators so
 * `2026_ana_green` and `city-safari-brisbane` tokenise like prose; and a trailing `s` is dropped from longer words so
 * that "City Safaris in Europe" still reaches "City Safari: Marseille", which is the difference between a candidate a
 * reader can act on and silence.
 */
export function tokens(text: string) {
  const folded = text.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
  const words = folded.match(/[a-z0-9]+/g) ?? [];

  return new Set(
    words
      .map((word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word))
      .filter((word) => !STOPWORDS.has(word)),
  );
}

/**
 * How much of `name` the `headline` already says, from 0 to 1.
 *
 * Containment rather than similarity, because the two sides are not trying to say the same thing: Niantic writes
 * "Rescue Shadow Zekrom during Harvest Festival: Taken Over!" where Leek Duck writes "Harvest Festival: Taken Over", so
 * the feed name sits *inside* the headline surrounded by marketing. A symmetric ratio punishes exactly the verbosity
 * that makes the pair obvious, and would rank the wrong Harvest Festival first.
 */
export function containment(name: string, headline: string) {
  const wanted = tokens(name);
  const said = tokens(headline);

  return wanted.size ? [...wanted].filter((word) => said.has(word)).length / wanted.size : 0;
}
