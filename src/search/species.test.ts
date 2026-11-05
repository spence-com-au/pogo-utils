/**
 * The rows the name box offers, which close a gap nothing else here can: `pokedex.js` names a species by a constant
 * with its punctuation dropped, so a reader can type `farfetchd` where the game answers to `Farfetch'd`. The fold is
 * on the matching side and the row writes the game's own spelling back.
 *
 * So every failure here is a query that looks right and finds the wrong thing, or nothing — and a row is taken on
 * trust and pasted into a search that drives a mass transfer, so none of it surfaces as an error.
 */

import { expect, test } from 'vitest';

import POKEMON from '../pokemon/pokedex.js';
import { fold, nameOf } from '../pokemon/names.js';
import { stepped, suggestions, written } from './species.js';

/** Every released species as the name a row would offer, in dex order — the whole of what the list draws from. */
const OFFERABLE = Object.entries(POKEMON)
  .filter(([, species]) => species.released)
  .map(([constant]) => nameOf(constant));

/**
 * How many released names a fragment begins and how many merely carry it — the two groups the list orders by. Spelled
 * out here to pin the dex a case stands on rather than to check the module against itself, which is why every number
 * below it is a literal.
 */
const reach = (needle: string) => ({
  begins: OFFERABLE.filter((name) => fold(name).startsWith(needle)).length,
  carries: OFFERABLE.filter((name) => fold(name).indexOf(needle) > 0).length,
});

test("only a species the game has put out is offered, the search running over a reader's own storage", () => {
  const man = Object.entries(POKEMON).filter(([constant]) => fold(nameOf(constant)).startsWith('man'));

  // Manaphy is a Mythical that is not in the game, and it is fifth of the six species whose name begins `man`. So the
  // gate is not just a shorter list here: nine released species reach `man` and there are eight rows, so letting
  // Manaphy in partway up takes Darmanitan off the end — a species nobody can catch displacing one they can.
  expect(man.map(([constant, species]) => [nameOf(constant), species.released])).toEqual([
    ['Mankey', true],
    ['Mantine', true],
    ['Manectric', true],
    ['Mantyke', true],
    ['Manaphy', false],
    ['Mandibuzz', true],
  ]);
  expect(reach('man')).toEqual({ begins: 5, carries: 4 });

  expect(suggestions('+man').map((offer) => offer.name)).toEqual([
    'Mankey',
    'Mantine',
    'Manectric',
    'Mantyke',
    'Mandibuzz',
    'Charmander',
    'Omanyte',
    'Darmanitan',
  ]);
});

test('a name a species begins is offered ahead of one that merely carries it, whatever the dex says', () => {
  // Mime Jr. and Mr. Mime are the pair where the grouping and the dex disagree outright, so ordering by number alone
  // would answer Mr. Mime first. A reader who has typed `mime` has almost certainly begun a name rather than landed in
  // the middle of one, and the two groups are what say so.
  expect([Number(POKEMON.MR_MIME), Number(POKEMON.MIME_JR)]).toEqual([122, 439]);
  expect(reach('mime')).toEqual({ begins: 1, carries: 1 });
  expect(suggestions('mime').map(written)).toEqual(['mime jr.', '+mime jr.', 'mr. mime', '+mr. mime']);

  // And each group keeps the dex order inside it, which `char` shows in both halves at once: Chimchar carries the
  // fragment and so comes last, behind two species numbered far above it.
  expect([Number(POKEMON.CHIMCHAR), Number(POKEMON.CHARJABUG), Number(POKEMON.CHARCADET)]).toEqual([390, 737, 935]);
  expect(reach('char')).toEqual({ begins: 5, carries: 1 });
  expect(suggestions('+char').map((offer) => offer.name)).toEqual([
    'Charmander',
    'Charmeleon',
    'Charizard',
    'Charjabug',
    'Charcadet',
    'Chimchar',
  ]);
});

test('a family is a row of its own, directly beneath the species it came from', () => {
  // Adjacent rather than appended as a second block, so one `↓` from a species reaches its family and which of the two
  // searches a row writes is settled by taking that row and by nothing else.
  expect(reach('fetchd')).toEqual({ begins: 0, carries: 2 });
  expect(suggestions('fetchd').map(written)).toEqual(["farfetch'd", "+farfetch'd", "sirfetch'd", "+sirfetch'd"]);
});

test('the marker asks for families alone, which changes what is reachable and not only what is written', () => {
  // Eight rows is four species while a family takes a row, so the cap bites twice as soon — `+char` reaches Charcadet
  // and Chimchar where `char` spends the whole list on the first four. That is the cost of a family being a row rather
  // than a mode, and it is worth seeing rather than inferring.
  // Every one of those rows is a family and not the species beside it, which is the whole of what the marker asked for:
  // a row writing `charmander` to a reader who typed `+char` hands back the one search they have said they do not want,
  // and it would read as the right row on the page.
  expect(suggestions('+char').map(written)).toEqual([
    '+charmander',
    '+charmeleon',
    '+charizard',
    '+charjabug',
    '+charcadet',
    '+chimchar',
  ]);

  expect(suggestions('char')).toHaveLength(8);
  expect(suggestions('char').map((offer) => offer.name)).not.toContain('Charcadet');

  // The cap counts rows, so a value reaching seventeen names is cut to four of them rather than to eight.
  expect(reach('ch')).toEqual({ begins: 17, carries: 35 });
  expect([...new Set(suggestions('ch').map((offer) => offer.name))]).toEqual([
    'Charmander',
    'Charmeleon',
    'Charizard',
    'Chansey',
  ]);
});

test('a row writes the name the game shows rather than the one that was typed to reach it', () => {
  // The whole purpose of the list. `FARFETCHD` drops an apostrophe the game's name carries, so `farfetchd` is what a
  // reader can type and the query that finds nothing; the fold matches it and the row hands back the spelling.
  expect(fold("Farfetch'd")).toBe('farfetchd');
  expect(suggestions('farfetchd').map(written)).toEqual(["farfetch'd", "+farfetch'd"]);
  expect(suggestions('flabebe').map(written)).toEqual(['flabébé', '+flabébé']);

  // Nidoran is the sharpest of the three, the symbol being the species' whole distinguishing mark: writing the folded
  // name would collapse these two rows into one search reaching both, which is the one thing the list is asked for.
  expect(suggestions('nidoran').map(written)).toEqual(['nidoran♀', '+nidoran♀', 'nidoran♂', '+nidoran♂']);
});

test('a fragment shorter than two characters offers nothing, the marker included', () => {
  // One character names too much of the dex for four rows to say anything useful about it, so the list stays shut
  // rather than answering with whichever four come first.
  expect(suggestions('c')).toEqual([]);
  expect(suggestions('ch')).not.toEqual([]);

  // The marker says which of the two searches is meant and names nothing on its own, so it is not one of the two.
  expect(suggestions('+')).toEqual([]);
  expect(suggestions('+c')).toEqual([]);
});

test('the value is trimmed before the marker is read, so a leading space cannot change what a row writes', () => {
  // The fold drops a space as readily as it drops the marker, so what the trim is for is the `startsWith` above it: on
  // ` +char` an untrimmed value reads as carrying no marker, and a reader who asked for families is handed species.
  expect(suggestions(' +char ')).toEqual(suggestions('+char'));

  // Which also makes taking the marker off before folding documentation rather than behaviour — `fold` keeps neither it
  // nor the spaces, so folding the whole value answers the same needle. Asserted so the inertness is visible.
  expect([fold(' +char '), fold('char')]).toEqual(['char', 'char']);
});

test('a form or a regional variant is not a row, because the game searches the species name either way', () => {
  // Rattata carries the Alolan form and the game calls both of them `Rattata`, so `Alolan Rattata` is a name nothing
  // answers to — a row offering it would look like the more precise of the two and match nothing at all.
  expect(POKEMON.RATTATA.variants).toHaveLength(1);
  expect(suggestions('rattata').map(written)).toEqual(['rattata', '+rattata']);
});

test('arrowing past either end of the rows lands on what was typed before wrapping to the other end', () => {
  // Three rows, and the slot of the typed text at -1.
  expect([-1, 0, 1, 2].map((active) => stepped(active, 1, 3))).toEqual([0, 1, 2, -1]);
  expect([-1, 0, 1, 2].map((active) => stepped(active, -1, 3))).toEqual([2, -1, 0, 1]);

  // One row is two slots, and a step either way is the other one.
  expect([stepped(-1, 1, 1), stepped(0, 1, 1), stepped(-1, -1, 1), stepped(0, -1, 1)]).toEqual([0, -1, 0, -1]);
});
