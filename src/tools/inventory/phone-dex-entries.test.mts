/** What `pnpm inventory dex` records off one entry, on the phone `test-pokedex.mts` models: shinies and genders. */

import { direction, harness, SLOW } from './node/test-phone.mts';
import { linesIn, Pokedex } from './node/test-pokedex.mts';
import { describe, expect, test } from 'vitest';

describe('dex', () => {
  /**
   * Ekans's entry, whose SHINY tile the game draws as a silhouette though the shiny is registered (#1047). A tap
   * selects it, so the line has the shiny, and the entry is put back to the form's own before its tab is read further.
   */
  test('records a shiny whose silhouetted SHINY tile the game selects at a tap', { timeout: SLOW }, async (context) => {
    const phone = new Pokedex([['ekans-0', 'ekans-1']]);
    const { cwd, inventory } = await harness(context, phone, ['Ekans']);

    await inventory('dex', '--from', '1', '--to', '23');

    expect(linesIn(cwd)).toStrictEqual([
      {
        dex: 23,
        species: 'Ekans',
        caught: true,
        genders: { male: true, female: true },
        forms: [
          {
            form: null,
            caught: true,
            shiny: true,
            perfect: false,
            lucky: true,
            xxl: false,
            xxs: true,
            shadow: false,
            purified: false,
          },
        ],
        costumes: [],
        notes: [],
      },
    ]);
    expect(phone.unrestored, 'the tab was read on with the shiny selected').toStrictEqual([]);
  });

  /**
   * Golem's entry, seen and never caught, whose two forms are both silhouettes that no tap selects, so neither is
   * viewed: the genders are the ones the entry draws as it opens (#1070).
   */
  test('records the genders of a species with several forms and none caught', { timeout: SLOW }, async (context) => {
    const phone = new Pokedex([['golem-0']]);
    const { cwd, inventory } = await harness(context, phone, ['Golem']);

    await inventory('dex', '--from', '1', '--to', '76');

    expect(linesIn(cwd).map(({ dex, genders }) => ({ dex, genders }))).toStrictEqual([
      { dex: 76, genders: { male: false, female: false } },
    ]);
  });

  /**
   * Porygon's entry and a swipe on to Omanyte's, the step on which a full walk read Omanyte no genders (#1071). Porygon
   * draws the empty ring of a species the game master gives no gender, which is recorded as none without a second look
   * at the entry; Omanyte draws both.
   */
  test('records no genders for a genderless species without looking again', { timeout: SLOW }, async (context) => {
    const phone = new Pokedex([
      ['porygon-0', 'porygon-1'],
      ['omanyte-0', 'omanyte-1'],
    ]);
    const { cwd, inventory } = await harness(context, phone, ['Porygon', 'Omanyte']);

    await inventory('dex', '--from', '1', '--to', '138');

    expect(linesIn(cwd).map(({ dex, genders, notes }) => ({ dex, genders, notes }))).toStrictEqual([
      { dex: 137, genders: {}, notes: [] },
      { dex: 138, genders: { male: true, female: true }, notes: [] },
    ]);

    // A second look would leave Porygon for Omanyte and come back before the walk went on to it.
    expect(
      phone.calls
        .filter((call) => call.startsWith('shell input swipe '))
        .map((call) => direction(call.split(' ').slice(3).map(Number)))
        .filter((way) => way === 'left'),
      'one swipe on, from Porygon to Omanyte',
    ).toStrictEqual(['left']);
  });
});
