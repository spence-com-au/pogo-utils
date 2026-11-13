/**
 * Every term the builder can put in a search string, grouped the way the page lays them out. One table, so a term is
 * added, corrected or relabelled in a single place and the page, the query writer and the shareable link all follow.
 *
 * `term` is what goes in the string, verbatim and lowercased, because that is what the game reads, where `label` is
 * what the chip says: `4*` is a term no label would spell that way. `id` is what a link carries (`#i=shiny.evolve`),
 * so it is stable in a way a label is not, and defaults to the term where that is already a plain word.
 *
 * `exclusive` and `exhaustive` are the two facts `optimise.js` shortens a clause by: at most one term is ever true, and
 * at least one always is. Neither follows from the other — Type is exhaustive and not exclusive, where Appraisal is
 * both and Size only exclusive — and each buys a reduction of its own, which is why they are two fields. Generation
 * carries neither, though a species is in exactly one: its terms are dex spans, which `optimise.js` folds into the one
 * span covering them, and declaring the fact would only let the weaker reduction win.
 *
 * A term's `covers` names the terms it is the union of, which `background` is of the two backdrops. It costs that group
 * the exclusivity above, `background` overlapping both the terms it covers, so `background&!locationbackground` is the
 * Event backdrops and a search a reader would want.
 *
 * A group's `hue` tints its chips. Hues rather than the palette's tokens, these being categories of the page's own;
 * `theme.css` owns the colours that carry meaning across pages. Fifteen hues is as far as that carries: the widest gap
 * left on the wheel is 30°, so a sixteenth would land within 15° of a neighbour and stop saying which group it is.
 *
 * Which is why the four groups that read a *type* share one. A hue names a category and all four of them are the
 * eighteen types — what separates them is the operator, and that is in each chip's own label rather than in its colour.
 */

import { GENERATIONS, LAST_DEX } from '../pokemon/generations.js';

export interface Term {
  id: string;
  term: string;
  label: string;
  covers?: readonly string[];
}

export interface Group {
  id: string;
  label: string;
  hue: number;
  help?: string;
  terms: readonly Term[];
  exclusive?: boolean;
  exhaustive?: boolean;
}

export interface Range {
  id: string;
  prefix: string;
  label: string;
  max: number;
  min?: number;

  /**
   * The phrase after the span rather than in front of it, which the three IV ranges are the whole of: `hp{N}` is the
   * stat where `{N}hp` is the IV, and the game reads `4hp`, `3-defense` and `-1attack` alike. A field rather than a
   * second kind of range, since every reader of one already wraps a span in its prefix and now wraps it in both.
   */
  suffix?: string;

  /**
   * What each value is called where the game names them, indexed by the value itself: a range carrying these draws
   * named dropdowns in place of its two number boxes, so it has to run from 0 to `max` for an index to be a value.
   * `terms.test.js` holds whichever ranges have them to that.
   */
  levels?: readonly string[];

  /**
   * Whether only some species hold a value at all, so that a span over the whole range still asks for those. The
   * community phrase list gives "Dynamax returns only dynamax species", `maxmove1-` as what "finds everything useable
   * in Max Battles" and `mega` — "a shortcut of `mega0-`" — as the way to find a Mega Evolution. Every other range is
   * one every Pokémon has a value in, so there a span from the floor to the ceiling cannot change what a query matches.
   */
  sparse?: boolean;
}

/**
 * One thing a preset rules out: a term by its id, or a span of one of the `RANGES` open above `from`, which is the
 * `{phrase}{N}-` the game reads as values at or above `{N}`. A preset carries the one bound it means and no ceiling,
 * there being no ceiling in what that writes.
 *
 * `RangeId` rather than `string`, so the range is one that exists; `query.js` clamps the bound, a preset being the
 * fourth builder of a span pill and held to the same reading as the three `bounded` already names.
 */
export type Excluded = string | { range: RangeId; from: number };

/**
 * A starting point: the exclusions `presetTree` builds pill by pill, or a query read the way a typed one is.
 *
 * Safe to transfer stays a list because a misspelt word in a query reads as a name pill, and the exclusion it meant
 * goes missing in silence. A misspelt id writes nothing, which `query.test.js` catches.
 */
export type Preset = { id: string; label: string; note: string } & (
  { exclude: readonly Excluded[] } | { query: string }
);

/**
 * The eighteen types. Listed in the games' own order rather than alphabetically, which is the order a player has seen
 * them in every type chart since 1999 — sorting them A-Z would put Bug before Fire and read as a list of words rather
 * than as the chart.
 */
const TYPES = [
  'normal',
  'fire',
  'water',
  'electric',
  'grass',
  'ice',
  'fighting',
  'poison',
  'ground',
  'flying',
  'psychic',
  'bug',
  'rock',
  'ghost',
  'dragon',
  'dark',
  'steel',
  'fairy',
];

const capitalise = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * The eighteen types under one of the four operators that read them, as a group's worth of terms. The game spells each
 * reading as a mark in front of the type — nothing for the type a Pokémon is, `<` for what hurts it, `>` for what it
 * can hurt and `@` for a move it carries — so one function writes all four and no type name is transcribed four times.
 *
 * **The mark is in the label as well as in the term.** All four groups share a hue, the wheel having no room for a
 * sixteenth: the mark is what tells a reader that the pill on a card is `<fire` and not `fire`, which the colour
 * can no longer say. It is also the `id` prefix, ids being flat across every group and `fire` belonging to the first.
 */
const typeTerms = (id: string, mark: string): Term[] =>
  TYPES.map((type) => ({ id: `${id}${type}`, term: `${mark}${type}`, label: `${mark} ${capitalise(type)}`.trim() }));

export const GROUPS: readonly Group[] = [
  {
    id: 'status',
    label: 'Status',
    hue: 8,
    help:
      'For a lucky shiny, put each on its own card. `candyxl` misses a Best Buddy boosted past 40, and ' +
      '`hypertraining` finds Pokémon still in training, not finished ones.',
    terms: [
      { id: 'shiny', term: 'shiny', label: 'Shiny' },
      { id: 'lucky', term: 'lucky', label: 'Lucky' },
      { id: 'costume', term: 'costume', label: 'Costume' },
      { id: 'candyxl', term: 'candyxl', label: 'Powered past 40' },
      { id: 'hypertraining', term: 'hypertraining', label: 'Hyper Training' },
    ],
  },
  {
    id: 'rarity',
    label: 'Rarity',
    hue: 70,
    exclusive: true,
    terms: [
      { id: 'legendary', term: 'legendary', label: 'Legendary' },
      { id: 'mythical', term: 'mythical', label: 'Mythical' },
      { id: 'ultrabeast', term: 'ultrabeast', label: 'Ultra Beast' },
    ],
  },
  {
    id: 'rocket',
    label: 'Team GO Rocket',
    hue: 292,
    exclusive: true,
    terms: [
      { id: 'shadow', term: 'shadow', label: 'Shadow' },
      { id: 'purified', term: 'purified', label: 'Purified' },
    ],
  },
  {
    id: 'mega',
    label: 'Mega and Max',
    hue: 95,
    help: 'Matches by species, not by what your own Pokémon can do.',
    terms: [
      { id: 'megaevolve', term: 'megaevolve', label: 'Can Mega Evolve' },
      { id: 'dynamax', term: 'dynamax', label: 'Can Dynamax' },
      { id: 'gigantamax', term: 'gigantamax', label: 'Can Gigantamax' },
    ],
  },
  {
    id: 'appraisal',
    label: 'Appraisal',
    hue: 145,
    exclusive: true,
    exhaustive: true,
    help: 'The appraisal’s star rating: 4 ★ is 100%.',
    terms: [
      { id: 'star0', term: '0*', label: '0 ★' },
      { id: 'star1', term: '1*', label: '1 ★' },
      { id: 'star2', term: '2*', label: '2 ★' },
      { id: 'star3', term: '3*', label: '3 ★' },
      { id: 'star4', term: '4*', label: '4 ★' },
    ],
  },
  {
    id: 'evolution',
    label: 'Evolution',
    hue: 265,
    help: '`New to the dex` evolves into a species you have not registered.',
    terms: [
      { id: 'evolve', term: 'evolve', label: 'Can evolve now' },
      { id: 'evolvenew', term: 'evolvenew', label: 'New to the dex' },
      { id: 'item', term: 'item', label: 'Needs an item' },
      { id: 'tradeevolve', term: 'tradeevolve', label: 'Evolves free after trade' },
      { id: 'evolvequest', term: 'evolvequest', label: 'Needs a buddy task' },
      { id: 'fusion', term: 'fusion', label: 'Can fuse' },
      { id: 'eggsonly', term: 'eggsonly', label: 'Baby' },
    ],
  },
  {
    id: 'moves',
    label: 'Moves',
    hue: 120,
    help:
      'The game fills a locked second charged slot with a move named `move_name_0000`, which `@3move` matches. Rule ' +
      'it out to find Pokémon with a second move.',
    terms: [
      { id: 'special', term: '@special', label: 'Exclusive move' },
      { id: 'adventureeffect', term: 'adventureeffect', label: 'Adventure Effect' },
      { id: 'weather', term: '@weather', label: 'Weather boosted' },
      { id: 'secondmove', term: '@3move', label: 'No second charged move' },
    ],
  },
  {
    id: 'origin',
    label: 'How you got it',
    hue: 200,

    /*
     * Three of these the game does not answer the way the label reads, per the community phrase list. They keep their
     * chips — the game takes all three terms — but the help says so, this page's output being what a mass transfer is
     * run from, and says whose claim it is: none of the three was checked against the game, and `primalraid` is a bug
     * Niantic can fix out from under the sentence.
     */
    help:
      'The community phrase list reports three that fail: `EX raid` finds nothing now, `Primal raid` is broken, and ' +
      '`From Team GO Rocket` misses Shadows from raids or research, which `Shadow` or `Purified` finds.',

    terms: [
      { id: 'traded', term: 'traded', label: 'Traded' },
      { id: 'hatched', term: 'hatched', label: 'Hatched' },
      { id: 'raid', term: 'raid', label: 'Raid' },
      { id: 'remote', term: 'remoteraid', label: 'Remote raid' },
      { id: 'exraid', term: 'exraid', label: 'EX raid' },
      { id: 'megaraid', term: 'megaraid', label: 'Mega raid' },
      { id: 'primalraid', term: 'primalraid', label: 'Primal raid' },
      { id: 'research', term: 'research', label: 'Research' },
      { id: 'party', term: 'party', label: 'Party Play' },
      { id: 'rocket', term: 'rocket', label: 'From Team GO Rocket' },
      { id: 'gbl', term: 'gbl', label: 'GO Battle League' },
      { id: 'snapshot', term: 'snapshot', label: 'Photobomb' },
      { id: 'defender', term: 'defender', label: 'In a gym' },
    ],
  },
  {
    id: 'background',
    label: 'Background',
    hue: 220,
    help: '`Any background` matches either kind.',
    terms: [
      { id: 'locationbackground', term: 'locationbackground', label: 'Location' },
      { id: 'specialbackground', term: 'specialbackground', label: 'Event' },

      /**
       * `background` is the union of the two above, so as an inclusion it says nothing picking both does not. It earns
       * its chip on the other side: ruling it out is one clause where refusing both is two, and a search string has a
       * reader typing it on a phone. `covers` is that union said to `optimise.js`, which writes this in place of both
       * on whichever side they were picked — so the chip saves those characters for the reader who did click twice.
       */
      {
        id: 'background',
        term: 'background',
        label: 'Any background',
        covers: ['locationbackground', 'specialbackground'],
      },
    ],
  },
  {
    id: 'kept',
    label: 'Kept aside',
    hue: 35,
    help: 'Worth ruling out before a mass transfer.',
    terms: [
      { id: 'favorite', term: 'favorite', label: 'Favourite' },

      /**
       * A tag is searched by the name its owner gave it, so `#` — the game's "has any tag at all" — is the only tag
       * search a chip can offer without knowing what a reader called theirs. Ruling it out writes `!#`, the untagged
       * half, which is what makes one chip enough for both.
       */
      { id: 'tagged', term: '#', label: 'Tagged' },
    ],
  },
  {
    id: 'gender',
    label: 'Gender',
    hue: 344,
    exclusive: true,
    exhaustive: true,
    terms: [
      { id: 'male', term: 'male', label: 'Male' },
      { id: 'female', term: 'female', label: 'Female' },
      { id: 'genderunknown', term: 'genderunknown', label: 'Unknown' },
    ],
  },
  {
    id: 'size',
    label: 'Size',
    hue: 52,
    exclusive: true,
    help: 'Most Pokémon are none of these, so ruling one out barely narrows a search.',
    terms: [
      { id: 'xxs', term: 'xxs', label: 'XXS' },
      { id: 'xs', term: 'xs', label: 'XS' },
      { id: 'xl', term: 'xl', label: 'XL' },
      { id: 'xxl', term: 'xxl', label: 'XXL' },
    ],
  },
  {
    id: 'form',
    label: 'Regional forms',
    hue: 320,

    /*
     * No `exclusive`, though five regions read as though nothing could be two of them. The community phrase list
     * names the exception outright — the early generations "permanently exclude regional forms", which "also makes
     * Hisuian Decidueye the only pokemon which can be found by searching for two regions together", Decidueye being
     * an Alola species. So `alola&hisui` matches one Pokémon, and declaring the fact would license `optimise.js` to
     * write `alola&!hisui` as `alola` — dropping exactly that one, quietly.
     */
    help:
      '`kanto` leaves out regional variants, so it is narrower than the Gen 1 chip: `1-151` matches an Alolan Vulpix ' +
      'and `kanto` does not.',

    terms: [
      { id: 'kanto', term: 'kanto', label: 'Kantonian' },
      { id: 'alola', term: 'alola', label: 'Alolan' },
      { id: 'galar', term: 'galar', label: 'Galarian' },
      { id: 'hisui', term: 'hisui', label: 'Hisuian' },
      { id: 'paldea', term: 'paldea', label: 'Paldean' },
    ],
  },
  {
    id: 'type',
    label: 'Type',
    hue: 175,
    exhaustive: true,
    terms: typeTerms('', ''),
  },
  {
    id: 'weakto',
    label: 'Weak to',
    hue: 175,
    help: 'Counts both of its types, so a Fire and Water Pokémon is not `<water`.',
    terms: typeTerms('weak', '<'),
  },
  {
    id: 'strongagainst',
    label: 'Strong against',
    hue: 175,
    help:
      'Has a move that is super effective against this type. The community phrase list reports that the second ' +
      'charged move is not counted.',
    terms: typeTerms('strong', '>'),
  },
  {
    id: 'movetype',
    label: 'Move type',
    hue: 175,

    /*
     * Exhaustive and not exclusive, for the same reason Type above is: every Pokémon has a move and every move has one
     * of these eighteen types, so all eighteen asked for at once is a search for everything — which is the reduction
     * the flag buys. Several at once is ordinary, a moveset being two or three moves of two or three types.
     *
     * Neither fact is stated for the two groups above it. Whether every species is weak to something, and which types
     * a moveset can reach, are both answers out of the type chart, and nothing in this repository holds one.
     */
    exhaustive: true,

    terms: typeTerms('move', '@'),
  },
  {
    id: 'generation',
    label: 'Generation',
    hue: 240,

    /**
     * A generation is not a search term — there is no `gen1` — so each chip is the dex span it covers, which is why
     * these are terms rather than one of the numeric ranges below. `pokemon/generations.js` owns the boundaries; this
     * is the only place that renders them as the `1-151` the game reads.
     */
    terms: GENERATIONS.map(({ number, first, last }) => ({
      id: `gen${number}`,
      term: `${first}-${last}`,
      label: `Gen ${number}`,
    })),
  },
];

/**
 * What each buddy level is called, indexed by the number the game searches it as: `buddy3` is a Great Buddy. Only the
 * top four have names — the community phrase list spells the first two "0 = never buddies, 1 = buddies, never leveled
 * up" — so those read as descriptions. The pill's dropdowns are drawn from these, which is the only place a reader
 * meets a buddy level without already knowing what the number means.
 */
const BUDDY_LEVELS: readonly string[] = [
  'never a buddy',
  'buddied but never levelled up',
  'Good Buddy',
  'Great Buddy',
  'Ultra Buddy',
  'Best Buddy',
];

/**
 * The numeric ranges, each written as its prefix and a span: `cp100-2000`. A bound left empty is left open rather than
 * filled from the range's own `min` or `max`, so one box filled writes `cp3000-`; `tree.js` says why.
 *
 * `max` bounds the input so a typo cannot write a range nothing can match, and is the ceiling the game itself has where
 * there is one — the dex ends where the last of `GENERATIONS` does, and no Pokémon reaches 500 HP.
 *
 * **Where the game documents no ceiling, `max` is generous rather than tight.** `bounded` below *clamps* rather than
 * refuses, so a ceiling set under what a search can really ask for turns that search into a different one in silence:
 * the three counts take five digits, which is past any storage or candy total the game can hold, where a figure chosen
 * to look plausible would have rewritten a real `countcandy50000`. Age takes five too, rather than a round number of
 * years: a Pokémon caught at launch in July 2016 goes on getting older, and a ceiling it passes clamps `age3700-` into
 * a search for younger ones as well. So does CP, which looks like it has a ceiling and does not: a perfect Crowned
 * Zacian at level 50 is 5629 CP by the game master's own stats, and a Mega Mewtwo Y is past 7000.
 *
 * `megalevel` is the one ceiling that is a judgement. Bulbapedia lists a fourth mega level, Super Max, and the
 * community phrase list gives "1/2/3/4 = Base/High/Max/Super Max" — but carries `// Super Max not personally confirmed
 * yet.` in its own source beside that row. So `max: 3` holds the level both sources stand behind and no more, and the
 * cost is that `mega4` pasted into the Advanced pane composes `mega3` rather than being refused. `buddylevel`'s 5
 * needs no such sentence: both sources give it outright.
 *
 * Buddy and Mega level belong here rather than among the terms above: they are levels, so a reader wants a span of them
 * — `Good Buddy or better` is `buddy2-`, the lower end picked and the upper left open — which is how the references
 * spell them too, Niantic's own list saying "enter `buddy0–5`" and Bulbapedia giving that very `buddy2-` as its
 * example. The Max move levels and the two counts of unlocked Max moves are here for the same reason, and all five
 * start at 1: a Max species has its attack unlocked from the first, so `{N}` counts from one and `dynamax0` is a
 * search for nothing.
 *
 * A level is also the *only* buddy search: those two references and the community phrase list all document `buddy{N}`,
 * and not one carries a flag for the buddy you have out, so there is no bare `buddy` among the terms above — the game
 * would read one as a nickname.
 *
 * A prefix that is the start of another prefix needs no ordering, `pill` in `parse.js` requiring the *tail* to be a
 * span: `countcandy248-` is not a `count` search, because `candy248-` is not a number.
 */
const RANGE_TABLE = [
  { id: 'cp', prefix: 'cp', label: 'CP', max: 99999 },
  { id: 'hp', prefix: 'hp', label: 'HP', max: 500 },
  { id: 'dex', prefix: '', label: 'Dex number', min: 1, max: LAST_DEX },
  { id: 'ivattack', prefix: '', suffix: 'attack', label: 'Attack IV', max: 4 },
  { id: 'ivdefense', prefix: '', suffix: 'defense', label: 'Defence IV', max: 4 },
  { id: 'ivhp', prefix: '', suffix: 'hp', label: 'HP IV', max: 4 },
  { id: 'buddylevel', prefix: 'buddy', label: 'Buddy level', max: 5, levels: BUDDY_LEVELS },
  { id: 'megalevel', prefix: 'mega', label: 'Mega level', max: 3, sparse: true },
  { id: 'dynamaxmoves', prefix: 'dynamax', label: 'Dynamax moves', min: 1, max: 3, sparse: true },
  { id: 'gigantamaxmoves', prefix: 'gigantamax', label: 'Gigantamax moves', min: 1, max: 3, sparse: true },
  { id: 'maxmove', prefix: 'maxmove', label: 'Max Attack level', min: 1, max: 3, sparse: true },
  { id: 'maxguard', prefix: 'maxguard', label: 'Max Guard level', min: 1, max: 3, sparse: true },
  { id: 'maxspirit', prefix: 'maxspirit', label: 'Max Spirit level', min: 1, max: 3, sparse: true },
  { id: 'count', prefix: 'count', label: 'Copies you have', min: 1, max: 99999 },
  { id: 'countcandy', prefix: 'countcandy', label: 'Candy', max: 99999 },
  { id: 'countcandyxl', prefix: 'countcandyxl', label: 'Candy XL', max: 99999 },
  { id: 'age', prefix: 'age', label: 'Age', max: 99999 },
  { id: 'distance', prefix: 'distance', label: 'Kilometres from home', max: 40000 },
  { id: 'year', prefix: 'year', label: 'Year caught', min: 2016, max: 2030 },
] as const satisfies readonly Range[];

export const RANGES: readonly Range[] = RANGE_TABLE;

/**
 * Whichever id the table above carries, as the union of the literals rather than `string` — the same reading
 * `router.js` takes of its own `PAGES`, and for the same reason: a preset naming a range it has misspelled is a type
 * error rather than a pill that writes nothing and an exclusion that goes missing from a transfer-safe string.
 *
 * Off the table before `RANGES` widens it, which is the whole of why there are two names for one list. `as const`
 * makes each row its own type, so a union of them has `min`, `suffix` and `levels` only where the row that reached it
 * did — and every reader of `RANGES` wants the one `Range` the annotation gives them.
 *
 * `satisfies` on the table rather than the annotation alone doing the checking, because an excess-property check fires
 * on a *fresh* object literal and these rows are no longer fresh by the time `RANGES` is assigned: without the clause
 * a row written `level:` for `levels` compiled, and drew number boxes for a range meant to have names.
 */
export type RangeId = (typeof RANGE_TABLE)[number]['id'];

/**
 * The phrases the game reads as a span rather than as the word they look like, each beside the range and the floor it
 * stands for. The community phrase list calls them shortcuts and lists four: `mega` for `mega0-`, `count` for
 * `count2-`, and `dynamax` and `gigantamax` for `dynamax1-` and `gigantamax1-`.
 *
 * The floor rather than the span, so the string is derived through the writer in `tree.js` wherever one is wanted and
 * nothing here can drift from what a pill of that range composes.
 *
 * Two of the four are also terms above, where the chip's own word *is* the shortcut — so a typed `dynamax` arrives as
 * the chip rather than as a span, both spellings asking the same thing and the chip's being shorter. That leaves the
 * reading below for `mega` and `count`, and leaves all four to the caveat in `clauses.js`.
 *
 * `greedy` is whether the phrase still swallows a longer word that starts with it. All four did; the list records
 * `mega` as patched in spring 2026 and the other three as remaining affected, which is what makes this a field.
 *
 * Read on the way in and never written on the way out. A reader pasting the game's own `count` gets the pill it stands
 * for, which is the courtesy `parse.js` already pays `cp3000-0`; composing one back would hand that reader a string
 * that is itself a shortcut, where the span spelled out is the one spelling nothing can swallow.
 */
export const SHORTCUTS: readonly { phrase: string; range: RangeId; from: number; greedy: boolean }[] = [
  { phrase: 'mega', range: 'megalevel', from: 0, greedy: false },
  { phrase: 'count', range: 'count', from: 2, greedy: true },
  { phrase: 'dynamax', range: 'dynamaxmoves', from: 1, greedy: true },
  { phrase: 'gigantamax', range: 'gigantamaxmoves', from: 1, greedy: true },
];

/**
 * The four shapes a span is written in, as one pattern: `100`, `100-200`, `100-` and `-200`. A match with neither bound
 * is not a span at all — a lone `-`, or the empty tail a text that is only a prefix leaves — so both readers check for
 * one before trusting the groups.
 *
 * One pattern because the two readers of it — `parse.js` and `optimise.js` — sit on either side of `tree.js`, which
 * writes these and reads none: `optimise.js` reads a dex pill back *through that writer*, so a copy loosened on its own
 * would silently stop recognising what the writer had just produced. What the readers do with an open end is still
 * theirs to decide, and they differ: `parse.js` leaves it open, where a span in `optimise.js` is a closed interval and
 * closes it against the dex.
 *
 * The bound after the dash sits inside the dash's own group, so a run of digits with no dash can only be the first
 * bound. With both bounds free to stand alone, a long run ending in anything but a digit is tried at every split
 * between them, which costs the square of its length on every render of a name pill read out of a shared link.
 */
export const SPAN = /^(\d+)?(?:(-)(\d+)?)?$/;

/**
 * A number inside a range's own limits, which is the whole of what `max` above bounds.
 *
 * Four builders make a span pill — the number boxes, a fragment a stranger wrote, a typed query and a preset — and a
 * pill out of any of them has to be one the others could have made. Otherwise the bound changes under the reader: a
 * typed `9hp` composed `9hp`, and the link that string wrote read back as `4hp`. A preset is this
 * repository's own writing rather than a stranger's, so what it is held to is that its string and its link agree.
 */
export const bounded = (value: number, range: Range) => Math.min(Math.max(value, range.min ?? 0), range.max);

/**
 * The lowest buddy level that has been a buddy at all, which is the bound *Safe to transfer* rules out from: level 0 is
 * everything never buddied, so reaching down to it would exclude nearly all of storage and leave nothing to transfer.
 */
const EVER_BUDDIED = 1;

/**
 * Starting points, each a plain state the builder loads and the reader then edits — the point is to land mid-way
 * through a query rather than to hand over a finished one.
 *
 * Each earns its place by being tedious, risky or obscure to click together. Safe to transfer is a long list of
 * exclusions, every one of which matters, and forgetting any single one of them is how a shiny ends up as candy. Nundo
 * is three spans, each set to 0 in its own pair of boxes, and Special moves rules out two moves and a species, each a
 * name typed by hand. Apex is a dex span and three chips that no label on the page puts together, the community phrase
 * list's own `249-250&shadow,purified&research`: `research` is what tells the Apex forms from a Shadow Lugia or Ho-Oh
 * caught in a raid. A start a reader could have clicked together out of two chips saves them nothing and costs every
 * reader a button to read past, so the chips carry those.
 */
export const PRESETS: readonly Preset[] = [
  {
    id: 'transfer',
    label: 'Safe to transfer',
    note: 'Rules out everything worth keeping.',
    exclude: [
      'shiny',
      'lucky',
      'shadow',
      'purified',
      'mythical',
      'costume',
      'special',
      'background',
      'favorite',
      { range: 'buddylevel', from: EVER_BUDDIED },
      'tagged',
      'defender',
      'star3',
      'star4',
      'xxs',
      'xxl',
    ],
  },
  {
    id: 'nundo',
    label: 'Nundo',
    note: 'Attack, defence and HP IVs all 0.',
    query: '0attack&0defense&0hp',
  },
  {
    id: 'specialmoves',
    label: 'Special moves',
    note: 'Exclusive moves, but not Frustration, Return or Smeargle.',
    query: '@special&!@frustration&!@return&!smeargle',
  },
  {
    id: 'apex',
    label: 'Apex',
    note: 'Apex Lugia and Ho-Oh, shadow or purified.',
    query: '249-250&shadow,purified&research',
  },
];

/**
 * Every range by id, for the readers that are handed one and need the range behind it: the pill writer, the pill
 * labeller, the pill renderer, the link reader, the shortcut a typed phrase stands for, the preset builder,
 * `clauses.js`'s caveat patterns and the optimiser's own `dex` lookup. Each had scanned `RANGES` for itself, and no
 * lookup by id goes any other way now — which is what makes the duplicate `id` that `terms.test.js` refuses worth
 * refusing: `parse.js` walks `RANGES` in order where every reader here takes the last row of a repeated id, so two
 * rows sharing one would have a typed `hp300-` read against one row's bounds and written against another's.
 *
 * Keyed by `string` rather than by `RangeId`, since what a fragment or a typed query hands over is whatever a stranger
 * wrote.
 */
export const RANGES_BY_ID: ReadonlyMap<string, Range> = new Map(RANGES.map((range) => [range.id, range]));

/**
 * Every term by id, for the link reader and the query writer — both are handed ids and need the term behind one.
 */
export const TERMS_BY_ID: ReadonlyMap<string, Term> = new Map(
  GROUPS.flatMap((group) => group.terms).map((term) => [term.id, term]),
);

/**
 * Every term's id by the text the game reads it as, for the query reader and the optimiser. The game tells no chip from
 * the same word typed, so a typed `dark` is the Dark type, and so is a name pill holding it.
 */
export const IDS_BY_TERM: ReadonlyMap<string, string> = new Map(
  GROUPS.flatMap((group) => group.terms).map((term) => [term.term, term.id]),
);
