/**
 * The end of the pipeline, which reads no screen at all: which species and form a reading is, and at what level. The
 * name narrows the candidates when it is a species' name, the types narrow them further, the height, PGSharp's
 * bracketed suffix and then the artwork separate what the numbers cannot, and a fold keeps one form where a costume
 * repeats it. What none of them settles is answered as the shortest name of the forms left, with the rest beside it:
 * `unseparated` is the half of the answer that says the screen never stated which.
 *
 * Here rather than in `detail.mts` because it consumes a reading instead of producing one — it is the only module that
 * asks the readers to agree with each other rather than each being separately right.
 */

import { closest, cpOf, fitsHeight, levelsOf, multiplierOf, type Form, type GameData } from './game-master.mts';
import { fold } from './ocr.mts';
import { nearest, type Signature } from './artwork.mts';
import { type Detail } from './detail.mts';
import { type Overlay } from './overlay.mts';

/**
 * The two suffixes PGSharp draws that are not the form's name. It labels a form by its index from `A`, which runs off
 * the end of the alphabet for Unown's last two: `'A'.charCodeAt(0) + 26` is `[` and `+ 27` is `\\`, where the game
 * master spells them out. Applied before the form is matched, `identify` comparing a suffix against a form name
 * exactly.
 */
const PGSHARP_FORMS = new Map([
  ['[', 'Exclamation Point'],
  ['\\', 'Question Mark'],
]);

/**
 * The artwork, for the forms whose numbers are identical. Handed in rather than fetched so `identify` stays a pure
 * function of what it is given: the scan builds the map by downloading icons and the test records them.
 */
export interface Artwork {
  signature: Signature;
  icons: ReadonlyMap<Form, Signature>;
}

export interface Identity {
  form: Form | null;
  levels: number[];
  nickname: string | null;
  notes: string[];

  /**
   * The CP this form at these IVs shows at this level, worked out rather than read. Null where the level is still
   * ambiguous, since two levels are two CPs and guessing between them would be worse than saying nothing.
   */
  cp: number | null;

  /** Other forms the numbers fit equally well, which a better reading of the same screen could still separate. */
  alternatives: Form[];

  /**
   * Forms the screen cannot separate from the answer at all, sharing its dex, its types and all three base stats. The
   * artwork is the only reader that could, and it has either declined or had no icon for every member — so this is
   * apart from `alternatives` because a scan reads a screen again for a reading that might improve, and a second look
   * cannot invent a field the game does not print.
   */
  unseparated: Form[];
}

/**
 * Which species and form this is, and at what level. The name narrows the candidates where it is a species' name, the
 * types narrow further, and the overlay's IVs against the HP settle the rest — which is also what identifies a Pokémon
 * whose nickname has hidden its species. Costumes share their base form's stats, so they are folded into it here.
 *
 * The overlay's level is a proposal rather than a fact, being the one field OCR gets wrong with any regularity: it is
 * kept only where the HP agrees the Pokémon can be that level, and reported as a disagreement where it does not.
 *
 * `dex` is a species read off the Pokémon's own Pokédex entry, for the two cases the detail screen's name cannot
 * give: a nickname printed where the species goes, and the `♀` or `♂` OCR loses. It outranks the name rather than
 * joining it, but the name still decides whether there is a **nickname**, so a Ho-Oh called `96%` keeps it. It says
 * nothing about the form.
 */
export function identify(
  data: GameData,
  detail: Detail,
  overlay: Overlay | null,
  artwork?: Artwork,
  dex: number | null = null,
): Identity {
  const notes: string[] = [];
  const iv = overlay?.iv ?? null;

  // Kept apart, because once a Pokédex entry is in play the species narrows the candidates and the name says whether
  // this Pokémon is nicknamed. With no `dex` they are the same value.
  const matched = detail.name ? closest(detail.name, data.species, (s) => s) : null;
  const entry = dex === null ? null : (data.forms.find((f) => f.dex === dex)?.species ?? null);
  const species = entry ?? matched;

  // Only where the name does not read as the entry's species at all. Both Nidoran fold to `nidoran`, so `matched` is
  // Nidoran♀ for either; compared directly, a Nidoran♂ entry would report the glyph loss it was opened to settle.
  if (entry !== null && matched !== null && detail.name && closest(detail.name, [entry], (s) => s) === null) {
    notes.push(`the Pokédex says ${entry}, where the name on the screen reads as ${matched}`);
  }

  const fits = (f: Form) =>
    (detail.types.length === 0 || sameTypes(f.types, detail.types)) &&
    (iv === null || detail.hp === null || levelsOf(data, f, iv, detail.hp).length > 0);

  let candidates = data.forms.filter((f) => f.species === species && fits(f));

  const searchable = iv !== null && detail.hp !== null && detail.types.length > 0;

  // The species the candidates are drawn from, until the numbers are searched across every species instead.
  let searched = species;

  if (candidates.length === 0 && searchable) {
    if (species) {
      notes.push(`the numbers do not fit any form of ${species}; searched every species`);
    }

    candidates = data.forms.filter(fits);
    searched = null;
  }

  // `fits` asks whether *some* level reproduces the HP, which is weaker than the screen can answer: the overlay states
  // a level too. A narrowing rather than part of `fits`, because the stated shortlist is a reading and can be wrong —
  // on `pikachu-witch-hat.png` it names no level the HP can be — where a hard filter would empty the list and send the
  // search across every species.
  const stated = overlay?.levels ?? [];

  // The shortlist where some candidate agreed with it, and empty where none did: a shortlist no form can be at was
  // misread, and nothing below should go on trusting it.
  let trusted: readonly number[] = [];

  if (stated.length > 0 && iv !== null && detail.hp !== null) {
    const agreeing = candidates.filter((f) =>
      levelsOf(data, f, iv, detail.hp as number).some((level) => stated.includes(level)),
    );

    if (agreeing.length > 0) {
      candidates = agreeing;
      trusted = stated;
    }
  }

  // The printed CP, the only thing on the screen separating forms that differ in attack or defense alone: HP is a
  // function of `stamina`, so every test above is blind to Deoxys' four and Dialga's two, where CP is a function of the
  // whole triple.
  //
  // A narrowing rather than a filter, and only where it leaves something, for the reason the stated levels are — the CP
  // is the hardest thing here to read, so a misread must not empty a list the numbers had narrowed correctly.
  // Restricted to the levels the shortlist admits where it was trusted, so this asks the same question the levels
  // narrowing did; where it was not, every level the HP admits is asked instead.
  //
  // `detail.cps` is on the same footing as the single read, which is what reaches the captures whose label went
  // unrecognised and those whose label line read a `/` nothing settled — `cp/56` offering 756 and 56 alike. Requiring
  // the arithmetic to reproduce one exactly is what makes a wrong one inert, and `cpsIn` and `readingsOf` are where
  // what each offers is measured.
  //
  // Nothing reports it when that fails, the disagreement below being gated on `detail.cp` — null on exactly the
  // captures left to candidates — so a candidate that does reproduce a form answers a form or a level silently. What
  // that takes is 73 CP on this corpus: `castform-rainy.png` read as `905` answers **Quaxwell**, no alternatives and no
  // notes. Two of the 17 captures left to candidates have such a number within 190 and the other 15 have none, which
  // `screens.test.mts` pins by forging one.
  //
  // The floor is a property of the candidate list rather than of the arithmetic, and the two differ by more than an
  // order of magnitude. `castform-rainy.png` is the floor because its nickname leaves no species established, so the
  // list is every form that fits; where a species *is* recognised the list is that species' forms and the nearest
  // sibling is far — 190 on `deoxys-defense.png`. Arithmetic alone says 16 there, an
  // Espeon reaching 1585 at the level its HP admits, but line 101 is reached only on an empty list and Deoxys' forms
  // fill it, so that number comes back as one Deoxys with the three the CP did not settle beside it.
  const printed = [detail.cp, ...detail.cps].filter((n): n is number => n !== null);

  const shows = (f: Form, level: number) => {
    const multiplier = multiplierOf(data, level);

    return iv !== null && multiplier !== null && printed.includes(cpOf(f, iv, multiplier));
  };

  if (printed.length > 0 && iv !== null && detail.hp !== null) {
    const hp = detail.hp;
    const showing = (f: Form) =>
      levelsOf(data, f, iv, hp)
        .filter((level) => trusted.length === 0 || trusted.includes(level))
        .some((level) => shows(f, level));
    const showingIt = candidates.filter(showing);

    if (showingIt.length > 0) {
      candidates = showingIt;
    }
  }

  // The candy the `EVOLVE` row asks for, all that separates Sinistea's Phony form at 50 from its Antique at 400, and
  // Poltchageist's Counterfeit from its Artisan likewise: every number above is the same between each pair.
  //
  // Evidence only where it matches a branch some candidate has. What the row prints can part from the game master — a
  // trade that makes the evolution free, an event that halves its cost — so a figure no candidate costs is taken as
  // unread rather than as ruling every candidate out. A form with no branch at all is kept, its row being something
  // the game master does not state: costumed Pikachu have none of their own and `pikachu-ash-hat.png` still asks 50.
  const candy = detail.evolveCandy;

  if (candy !== null && candidates.some((f) => f.evolveCandy.includes(candy))) {
    candidates = candidates.filter((f) => f.evolveCandy.length === 0 || f.evolveCandy.includes(candy));
  }

  // The height against the band its badge names, which is what separates forms the game master draws at different
  // sizes where every number above leaves them together: Pumpkaboo's and Gourgeist's four, a level 1 Large and Super at
  // 2/0/6 both showing 14 HP and CP 14. Their bands only touch — a Large is 0.5m to 0.6m, a Super 0.6m to 0.8m — so
  // `pumpkaboo-large.png`'s 0.57m under an XL badge is a Large.
  //
  // A narrowing only where it leaves something, for the reason the CP is one: a height misread, or a badge missed and so
  // taken for the middle band, must not empty a list the numbers had narrowed correctly.
  if (detail.height !== null) {
    const height = detail.height;
    const fitting = candidates.filter((f) => fitsHeight(f, height, detail.size));

    if (fitting.length > 0) {
      candidates = fitting;
    }
  }

  // PGSharp's own label, the only thing that can separate Unown's 28 letters, which share one set of base stats, one
  // type and one move pool. Ahead of the fold below, which otherwise collapses them to one, and only where it matches
  // something — a suffix read off the artwork must not empty a list the numbers had narrowed correctly.
  const drawn = overlay?.form ?? null;
  const labelled = drawn === null ? null : (PGSHARP_FORMS.get(drawn) ?? drawn);
  const named = labelled === null ? [] : candidates.filter((f) => f.form !== null && fold(f.form) === fold(labelled));

  if (named.length > 0) {
    candidates = named;
  } else if (labelled !== null) {
    notes.push(`the overlay says form "${labelled}", which is no form of ${searched ?? 'any species that fits'}`);
  }

  // The artwork, all that is left where the numbers are identical: Deerling's four seasons share
  // `115/100/155 Normal+Grass` exactly, so without it they come back as one answer and three it cannot separate.
  //
  // Every candidate has to carry a signature, or a form the game draws no icon for would be dropped for having no
  // artwork rather than for losing on its colours — which is why Spinda is never narrowed here. Costumes are left out:
  // they repeat their form's numbers with no icon of their own, so counting them would keep Pikachu's 67 from ever
  // letting the clone be told from the original.
  //
  // And only within one `(dex, stats, types)` group, the one `ambiguous` signs: between different numbers it is the
  // numbers that separate the forms, and a nicknamed Pokémon's search must not be settled on hue.
  const uncostumed = candidates.filter((f) => !f.costume);
  const [first] = uncostumed;

  if (artwork && first && uncostumed.length > 1 && uncostumed.every((f) => sameNumbers(f, first))) {
    const icons = new Map(uncostumed.map((f) => [f, artwork.icons.get(f)]));
    const known = [...icons].every(([, signature]) => signature !== undefined);
    const picked = known ? nearest(artwork.signature, icons as ReadonlyMap<Form, Signature>) : null;

    if (picked) {
      candidates = [picked];
    }
  }

  // Shortest name first and costumes last, which is what makes the answer the plainest form that fits and the group
  // below it a costume's base form rather than the costume.
  const [form = null, ...rest] = [...candidates].sort(
    (a, b) => Number(a.costume) - Number(b.costume) || (a.form?.length ?? 0) - (b.form?.length ?? 0),
  );

  // Split on what a second read of the same screen could do about them, and fold each side on what it is worth saying.
  //
  // The answer's own group is named in full: those forms are two answers however identical their numbers, and keeping
  // one answered the shortest name of a Deerling's four seasons whichever one it was. A costume there is the exception
  // the fold was written for — it repeats its base form exactly, so it is the same answer twice.
  //
  // Every other group gets one name, the shortest, as the fold always gave it. Naming them all instead put all 28 Unown
  // in a nicknamed capture's `could also be …` — a 606-character note on a search that crosses every species, where the
  // fold had always answered one.
  const unseparated: Form[] = [];
  const alternatives: Form[] = [];

  for (const f of rest) {
    if (form !== null && sameNumbers(form, f)) {
      if (!f.costume) {
        unseparated.push(f);
      }
    } else if (!alternatives.some((a) => sameNumbers(a, f))) {
      alternatives.push(f);
    }
  }

  // A name that does not read as the species answered, which is not the same as one reading as no species at all: a
  // Vaporeon called `Eevee` matches a species and is still nicknamed. Read against the answer rather than against
  // `matched`, so a Nidoran whose `♀` OCR lost is not taken for a nickname once the Pokédex has said which it is.
  const nickname =
    detail.name && (form ? closest(detail.name, [form.species], (s) => s) : matched) === null ? detail.name : null;

  const consistent = form && iv && detail.hp !== null ? levelsOf(data, form, iv, detail.hp) : [];
  const agreed = consistent.filter((l) => stated.includes(l));
  const admitted = agreed.length > 0 ? agreed : consistent;

  // The printed CP settles the level as it settled the form: HP moves by whole points and so can admit two adjacent
  // half-levels, where the CP differs between them. A narrowing, for the same reason as above.
  const showingAt = form ? admitted.filter((l) => shows(form, l)) : [];
  const levels = showingAt.length > 0 ? showingAt : admitted;

  if (species === null && nickname && !searchable) {
    notes.push('a nickname hides the species, and only the IVs, the HP and the types together can say what it is');
  } else if (form === null && (species || nickname)) {
    notes.push('no form fits the HP, IVs and types read');
  } else if (alternatives.length > 0) {
    notes.push(`could also be ${alternatives.map(label).join(', ')}`);
  }

  // Named rather than counted, and after the note above because this is the weaker claim of the two: the forms are
  // there, and which of them this is was never on the screen to read.
  if (unseparated.length > 0) {
    notes.push(`nothing on the screen separates it from ${unseparated.map(label).join(', ')}`);
  }

  if (stated.length > 0 && consistent.length > 0 && agreed.length === 0) {
    notes.push(`the overlay reads as level ${stated.join(' or ')}, none of which this HP can be`);
  }

  if (levels.length > 1) {
    notes.push(`level ambiguous: ${levels.join(' or ')}`);
  }

  const settled = levels.length === 1 ? (levels[0] ?? null) : null;
  const multiplier = settled === null ? null : multiplierOf(data, settled);
  const cp = form && iv && multiplier !== null ? cpOf(form, iv, multiplier) : null;

  // The two disagreeing means the level or the form is wrong rather than the arithmetic, CP being a pure function of
  // the three things above it.
  if (cp !== null && detail.cp !== null && cp !== detail.cp) {
    notes.push(`the screen reads CP ${detail.cp}, where this form at this level is ${cp}`);
  }

  return { form, cp, alternatives, unseparated, levels, nickname, notes };
}

export function label(f: Form): string {
  return f.form ? `${f.species} (${f.form})` : f.species;
}

/**
 * How many of a reading's notes another look at the same screen could clear, which is what a scan reads one again for.
 * Every note but the one `unseparated` raises: those forms share every number the screen prints, so a second read of it
 * answers the same thing, and chasing them would read every Pikachu twice for ever.
 *
 * Here rather than in the scan because `screens.test.mts` asserts which captures it reaches, and a second copy of the
 * arithmetic would be free to disagree with the one that decides what a pass costs.
 */
export const clearable = (identity: Identity): number =>
  identity.notes.length - Number(identity.unseparated.length > 0);

function sameTypes(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((t) => b.includes(t));
}

/**
 * Whether two forms are the same Pokémon to everything but the artwork: one dex, one set of types and one stat line.
 */
function sameNumbers(a: Form, b: Form): boolean {
  return (
    a.dex === b.dex &&
    sameTypes(a.types, b.types) &&
    a.attack === b.attack &&
    a.defense === b.defense &&
    a.stamina === b.stamina
  );
}
