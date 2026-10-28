/**
 * Writes the table the Pokédex page reads a species' picture out of: the icon to ask `pogo_assets` for, where the dex
 * number alone does not derive it. And beside it the types each species' entry is coloured by, read off the same form.
 *
 * Read from the committed game master rather than from PokeMiners' directory listing, so the build stays off the
 * network and the names cannot disagree with the ones the inventory tool matches a screenshot against. That file
 * already records, per form, whether the game has artwork for it and what it is called.
 *
 * Only the exceptions are written. Most of the dex is `pm{dex}.icon.png`, which `ordinaryIcon` derives, and a row
 * repeating it would be a copy of a value nothing needs copied.
 */

import { ordinaryIcon, type Icons } from '../src/pokedex/icons.ts';
import type { GameData } from '../src/tools/inventory/game-master.mts';
import { fold } from '../src/pokemon/names.ts';
import type { Types } from '../src/pokedex/types.js';
import { GAME_MASTER, POKEMON_ICONS, POKEMON_TYPES } from '../src/generated.ts';
import { readFileSync, writeFileSync } from 'node:fs';

const SPECIES = 'src/pokemon/pokedex.ts';

const data: GameData = JSON.parse(readFileSync(GAME_MASTER, 'utf8'));

/** Every form the game master holds, by the species it belongs to, in the order that file lists them. */
const forms = new Map<number, GameData['forms']>();

for (const form of data.forms) {
  forms.set(form.dex, [...(forms.get(form.dex) ?? []), form]);
}

/**
 * The form `pokedex.ts` declares first for a species, by dex number — Shellos's west sea, Aegislash's shield,
 * Mimikyu's disguise.
 *
 * It is the game's own because that table is written that way, not because the builders enforce it. `addForms`
 * *replaces* the cursor a trailing modifier lands on, so a species declaring its forms across two calls is scoping an
 * `isRegional()` to a subset and saying nothing about display order — Flabébé and Squawkabilly both led with the group
 * the game does not show until this was corrected, and `icons.test.mts` pins all four of those species for that
 * reason.
 *
 * Read as text rather than imported: that module reaches its `Pokemon` class through `'./pokemon.js'`, which Node
 * resolves literally when it strips types to run this, so importing it is an `ERR_MODULE_NOT_FOUND` whatever the
 * project files say. A quoted string is what makes the read simple — a region is passed as a bare constant
 * (`withRegion(GALAR)`), so the first quoted argument after a `new Pokemon(…)` is that species' first form and never
 * its region.
 */
function readSpecies(): { first: ReadonlyMap<number, string>; last: number; split: number[] } {
  const source = readFileSync(SPECIES, 'utf8');
  const first = new Map<number, string>();
  const dexes: number[] = [];
  const split: number[] = [];

  // Split on the constructor so each chunk holds one species, then take the first quoted argument in it.
  const chunks = source.split(/new Pokemon\((\d+)\)/).slice(1);

  for (let at = 0; at + 1 < chunks.length; at += 2) {
    const dex = Number(chunks[at]);
    const body = chunks[at + 1] ?? '';
    const form = /'([A-Z0-9_]+)'/.exec(body)?.[1];

    dexes.push(dex);

    if (form !== undefined) {
      first.set(dex, form);
    }

    // Where the leading group is load-bearing rather than incidental, which is what the report at the end names.
    if ((body.match(/addForms?\(/g) ?? []).length > 1) {
      split.push(dex);
    }
  }

  /*
   * A pattern that had gone stale would answer with a short map rather than an error, and every species would then
   * fall back to the alphabetical pick this exists to replace — the bug, restored silently.
   *
   * So the names read are checked against a count that ignores names: how many of these chunks call a form builder at
   * all. The two ask different questions of the same text and have to agree, where a floor written down here would be
   * a number to keep in step with the dex.
   */
  const declarations = (source.match(/new Pokemon\(/g) ?? []).length;
  const builders = chunks.filter((chunk, at) => at % 2 === 1 && /addForms?\(|withForm\(/.test(chunk)).length;

  if (declarations < 1000 || dexes.length !== declarations || first.size !== builders) {
    throw new Error(
      `${SPECIES}: read ${dexes.length} of ${declarations} species and ${first.size} first forms against ` +
        `${builders} species that declare one, so the pattern has gone stale`,
    );
  }

  return { first, last: Math.max(...dexes), split };
}

const { first: declared, last, split } = readSpecies();

/** How often the pick below had to fall back, which only Spinda should reach. */
const guessed: number[] = [];

/**
 * The form that stands for a species, out of the forms the game has artwork for: its picture is the species' picture,
 * and its types the ones the entry is coloured by. A costume is never it, Pikachu having 70 of them and no reason to be
 * shown in a party hat.
 *
 * The ordinary form where the species has one. Otherwise the form `pokedex.ts` declares first, matched by name: the
 * game master abbreviates what that table spells in full, so `PLANT_CLOAK` is offered `Plant` and `SHIELD_FORME` is
 * offered `Shield`. Order alone cannot stand in for it — the vend sorts by dex and leaves each species' forms
 * alphabetical, which picked Mimikyu with its disguise already broken and the white Galarian Darmanitan for the plain
 * Unovan species.
 */
function formOf(dex: number): GameData['forms'][number] | undefined {
  const plain = (forms.get(dex) ?? []).filter(({ costume, icon }) => !costume && icon !== null);
  const ordinary = plain.find(({ form }) => form === null);

  if (ordinary) {
    return ordinary;
  }

  const wanted = declared.get(dex);
  const named =
    wanted === undefined ? undefined : plain.find(({ form }) => form !== null && fold(wanted).startsWith(fold(form)));

  if (named === undefined && plain.length > 0) {
    guessed.push(dex);
  }

  return named ?? plain[0];
}

const icons: Record<string, string | null> = {};

/**
 * The types the Pokédex entry is coloured by, off the same form as its picture so the two cannot disagree — Galarian
 * Darmanitan's ice would otherwise tint the plain fire species. A species with no artwork still has its types, from
 * the first form the game master lists that is not a costume; Basculegion, with no form there at all, has no row.
 */
const types: Record<string, readonly string[]> = {};

let rendered = 0;

/*
 * `last` is every number the page draws a tile for, rather than only the ones the game master holds a form for.
 * Basculegion has no form in that file at all, and reading the bound from there left the page deriving
 * `pm902.icon.png` — a name `pogo_assets` does not hold either, so the card showed no picture rather than falling back
 * to the pixel sprite. It comes off `pokedex.ts` for the same reason one dex further out: that table is what the grid
 * renders, and a species added to it ahead of a re-vend would otherwise get no row and fail the same way.
 *
 * The game master is checked for the shape that can go empty: a `forms` key surviving a rename with nothing under it
 * leaves every species answering `null`, and the build would write a table saying the game has no artwork at all —
 * which is the silent return to pixel sprites the floor below is here to stop, arriving by a route that passes it.
 */
if (forms.size === 0) {
  throw new Error(`${GAME_MASTER}: holds no forms at all, so the fixture is unreadable`);
}

for (let dex = 1; dex <= last; dex++) {
  const form = formOf(dex);
  const icon = form?.icon ?? null;
  const typed = form ?? (forms.get(dex) ?? []).find(({ costume }) => !costume);

  if (typed !== undefined) {
    types[dex] = typed.types;
  }

  if (icon !== null) {
    rendered += 1;
  }

  if (icon !== ordinaryIcon(dex)) {
    icons[dex] = icon;
  }
}

/*
 * A reader that had stopped recognising the fixture's shape would answer `null` for every species and write a table
 * saying the game has no artwork at all — which looks like a successful build and silently returns the page to pixel
 * sprites. Counted against the forms read rather than against a number written down here, so the floor holds as
 * upstream releases species.
 */
if (rendered < last / 2) {
  throw new Error(`${GAME_MASTER}: only ${rendered} of ${last} species have an icon, so the fixture is unreadable`);
}

writeFileSync(POKEMON_ICONS, JSON.stringify(icons satisfies Icons));
writeFileSync(POKEMON_TYPES, JSON.stringify(types satisfies Types));

console.error(
  `${POKEMON_ICONS}: ${rendered} of ${last} species draw the game's own render, and ` +
    `${Object.values(icons).filter((icon) => icon === null).length} fall back to a pixel sprite`,
);

// Named rather than counted, so a species whose declared form stops matching says which it is rather than joining a
// tally nobody reads. Spinda is the standing one: its patterns are numbered where `pokedex.ts` names them.
if (guessed.length > 0) {
  console.error(`${POKEMON_ICONS}: no declared form matched for ${guessed.join(', ')}, so the first was taken`);
}

/*
 * The species whose leading `addForms` group is doing work the builders do not check. A second call scopes a trailing
 * modifier and carries no claim to display order, so for these the order in that file is the only thing saying which
 * form stands for the species — printed so that adding one is a line in the build log rather than a silent wrong
 * picture. Flabébé, Floette, Florges and Squawkabilly each led with the wrong group once.
 */
if (split.length > 0) {
  console.error(`${POKEMON_ICONS}: ${split.length} species split their forms over several calls — ${split.join(', ')}`);
}
