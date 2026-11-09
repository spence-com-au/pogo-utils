/**
 * The Pokédex entry screen, which is the way round the two things that hide a species from the detail screen: a
 * nickname printed where the name goes, and the `♀` or `♂` of a species' own name that OCR loses.
 *
 * **The dex number settles it and the name beside it does not.** Over the three captures measured, `0585`, `0032` and
 * `0029` read exactly right off the ordinary whole-screen pass, where the names come back `DEERLING`, `NIDORAN` and
 * `NIDORAN ?` — the two Nidoran losing their glyph here as they do on the detail screen, and `fold` mapping both to the
 * same `nidoran`.
 *
 * **It answers the species and never the form.** Opening an entry does not preselect that Pokémon's form, so the
 * selected tile says nothing about the Pokémon the walk came from however legible it is. Legible and meaningless is
 * the worst thing a reader can be offered, so nothing here reads it.
 *
 * **Nothing beats a wrong answer here**, which is what the cross-check below is for: the screen carries other
 * four-digit numbers — `SEEN 2763`, `CAUGHT 1499` — so a reader taking the first it finds would file a species off a
 * counter. A number is accepted only where it resolves to a species *and* the name beside it folds to that same
 * species. The species half refuses the counters, and the name half refuses the status bar, whose `09:00` reads as
 * `0900 M © Os` where 900 is Kleavor.
 */

import { fold, type Line } from '../../core/ocr.mts';
import { type GameData } from '../../core/game-master.mts';

/**
 * A four-digit number followed by a name, which is the shape of the entry's title and of nothing else on the screen.
 * Four digits and no more, so the tail of a longer run — a glyph read as a `9` ahead of `0032` — is not taken for one.
 *
 * Searched anywhere in the folded line rather than anchored, because the game draws a circular-arrows glyph ahead of
 * the number: it folds away to nothing on all three captures, reading as `©`, and an anchor would be betting that it
 * never reads as a letter. The name is matched loosely for the same reason and checked strictly below, and takes
 * digits after its first letter for `Porygon2`.
 */
const TITLE = /(?<!\d)(\d{4})\s+([a-z][a-z0-9 ]*)/;

/**
 * Which species a Pokédex entry screen is showing, as its dex number, or null where the screen does not say so beyond
 * doubt.
 *
 * `data` is here for the cross-check rather than for the lookup: the number names a species, the line names one too,
 * and the two have to be the same species before either is believed. That is what makes a `SEEN` or `CAUGHT` counter
 * inert — 2763 is no species, and a count that did happen to land on a dex number carries no name beside it.
 *
 * The name is compared by exact folded equality rather than through `closest`, which is a deliberate departure from
 * every other name here. Slack exists to rescue a reading that is the only evidence there is; this reading is not
 * evidence at all but a check on a number that already answered, so slack would only widen what the check lets past.
 * Both Nidoran fold to `nidoran` and pass it, which is the point: the check says the line agrees, and the **number**
 * says which of the two. The species has to lead the line rather than be the whole of it, since what follows the name
 * is OCR's reading of the `♀` or `♂` the name lost, or of the form counter beside it — `NIDORAN d` is still Nidoran.
 */
export function dexOn(lines: readonly Line[], data: GameData): number | null {
  const found = new Set<number>();

  for (const line of lines) {
    const match = TITLE.exec(fold(line.text));

    if (!match) {
      continue;
    }

    const [, digits = '', printed = ''] = match;
    const dex = Number(digits);
    const species = data.forms.find((f) => f.dex === dex)?.species;

    const name = printed.trim();

    if (species !== undefined && (name === fold(species) || name.startsWith(`${fold(species)} `))) {
      found.add(dex);
    }
  }

  // One line agreeing with itself is the whole of what this can be sure of. Two that disagree are a screen mid-swipe
  // between entries, which the game really does draw and a capture really does catch, and picking either would be
  // guessing at which half the walk is standing on.
  const [only] = found;

  return found.size === 1 && only !== undefined ? only : null;
}
