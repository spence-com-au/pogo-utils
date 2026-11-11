/**
 * The row `bin/inventory scan` writes for one Pokémon, put together from the reading the walk handed it, what each flag
 * pass found and what the look down its screen read of its moves. Here rather than in the script so the suite can hold
 * each field to what it came from, the script handing in the passes, the artwork and the look it reaches the phone by.
 */

import { type Colourings } from './artwork.mts';
import { DEX, type Wardrobe } from './costume.mts';
import { closest, type Form, type GameData } from '../../core/game-master.mts';
import { identify, settledForm, shadowOf } from './identify.mts';
import { type Looked } from './look.mts';
import { type OverlayBox } from './overlay.mts';
import { artworkIn, costumeIn } from './report.mts';
import { shaded, type Flag, type Mark, type Marks, type Reading, type Row } from './scan.mts';

/** What a row is put together with besides its reading. */
export interface Writing {
  data: GameData;
  icons: ReadonlyMap<Form, Colourings>;

  /** The Pokémon each flag's pass found; a flag with none is one not asked for, or one whose pass would not read. */
  marked: ReadonlyMap<Flag, Marks>;

  /** The tags `--tags` names, which a chip read off the screen is matched against. */
  tags: readonly string[];

  /**
   * Where PGSharp's overlay sits, asked for each time it is wanted rather than once: the walk's own reads can find it
   * while the moves are looked for.
   */
  boxes: { readonly box: OverlayBox | null };

  /** Pikachu's icons for its costume, as `costumeIn` asks for them. */
  wardrobe: () => Promise<Wardrobe | null>;

  /** The look down the screen for the moves, read for `form`; null for `--no-moves`, which leaves them unread. */
  look: ((form: Form | null) => Promise<Looked>) | null;
}

/** The row for `reading`, `index` counting from 0 as the walk does. */
export async function rowOf(
  reading: Pick<Reading, 'detail' | 'overlay' | 'id' | 'image'>,
  index: number,
  { data, icons, marked, tags, boxes, wardrobe, look }: Writing,
): Promise<Row> {
  const { detail, overlay, id: read, image } = reading;
  const notes: string[] = [];
  const iv = overlay?.iv ?? null;

  // Null for a flag not asked for, one whose pass would not read or a screen with no key to match it by, rather than a
  // `false` nothing checked.
  const flag = (f: Flag): Mark => marked.get(f)?.take(detail, overlay) ?? null;

  // Each pass's flag taken once, since `take` uses the match up.
  const passes = { shadow: flag('shadow'), purified: flag('purified') };

  // Identified again where the fields say whether this is shadow or purified, which is all that rules out a form the
  // game only hands out as a shadow, and which the reading the walk took could not know. A function, since a screen
  // asking no stardust is settled again off the screen the moves are read from.
  const settle = (powerUp: number | null) => {
    const shade = shaded(passes, shadowOf(data, { ...detail, powerUp }, read.levels));
    const identity =
      shade.shadowed === null
        ? read
        : identify(data, detail, overlay, artworkIn(image, boxes.box, icons), shade.shadowed);

    return { ...shade, id: identity };
  };

  let settled = settle(detail.powerUp);

  // Taken whatever the screen says, so that a match the pass holds for this Pokémon is used up here rather than left to
  // mark another. The caption is the screen stating it, where the pass can have been cut short.
  const passed = flag('lucky');
  const lucky = detail.lucky || passed;

  if (detail.hp === null) {
    notes.push('detail screen not read');
  }

  if (overlay === null) {
    notes.push(boxes.box ? 'overlay not read' : 'no PGSharp overlay found; is its IV display switched on?');
  }

  const looked = look ? await look(settled.id.form) : { moves: { fast: null, charged: [] }, powerUp: null, notes: [] };
  notes.push(...looked.notes);

  if (looked.powerUp !== null) {
    settled = settle(looked.powerUp);
  }

  const { shadow, purified, id } = settled;
  notes.push(...settled.notes);

  // The search's answer taken once, since `take` uses the match up, and handed to the artwork: a Pikachu the search did
  // not find wears no costume, and one it found is not the plain one. Any other species is named only by the search,
  // so it gets every costume it has, which is the most the screen says — or null, unknown, where it has none the game
  // data names or its species is unread, since an empty list would say it wears none.
  const costumed = flag('costume');
  const worn = await costumeIn(image, boxes.box, id, wardrobe, costumed);
  const named = [...new Set(data.costumes.filter((c) => c.dex === id.form?.dex).map((c) => c.name))];
  const costume =
    worn.costume ??
    (costumed === null || id.form?.dex === DEX ? null : costumed ? (named.length > 0 ? named : null) : []);

  if (worn.note) {
    notes.push(worn.note);
  }

  // A chip that matches nothing named is kept as it read rather than dropped, since a misread is worth seeing.
  const carried = detail.tags.map((t) => (tags.length > 0 ? (closest(t, tags, (n) => n, 0.3) ?? t) : t));

  return {
    index: index + 1,

    // A nickname says nothing of the species, so a Pokémon `identify` could not place is left null rather than filed
    // under it.
    species: id.form?.species ?? (id.nickname === null ? detail.name : null),

    nickname: id.nickname,
    dex: id.form?.dex ?? null,
    form: settledForm(id),
    gender: detail.gender,
    favourite: detail.favourite,
    tags: carried,
    costume,
    shiny: flag('shiny'),
    lucky,
    size: detail.size,
    shadow,
    purified,
    max: detail.max,
    cp: id.cp ?? detail.cp,
    hp: detail.hp,
    levels: id.levels,
    iv,
    moves: looked.moves,
    weight: detail.weight,
    height: id.height,
    types: detail.types,
    notes: [...notes, ...id.notes],
  };
}
