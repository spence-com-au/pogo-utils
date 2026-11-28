/**
 * Where `pnpm inventory dex` stops, on the phone `test-pokedex.mts` models: an entry it cannot read, or no more seen.
 */

import { harness, SLOW } from './node/test-phone.mts';
import { ENTRIES, KANTO_ICONS, linesIn, Pokedex } from './node/test-pokedex.mts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

describe('dex', () => {
  /**
   * A swipe from the third entry that moves the screen to one whose title does not read — the main menu, standing in for
   * an entry Tesseract makes nothing of. A second swipe would go past it and never read it, so the walk stops there and
   * says so, the three lines before it kept.
   */
  test(
    'stops on an entry whose title will not read, rather than swiping past it',
    { timeout: SLOW },
    async (context) => {
      const phone = new Pokedex([...ENTRIES, ['menu']]);
      const { cwd, inventory } = await harness(context, phone, ['Bulbasaur', 'Ivysaur', 'Venusaur'], KANTO_ICONS);
      const { code, stderr } = await inventory('dex', '--from', '1', '--to', '10');

      expect(code).toBe(1);
      expect(stderr).toContain('the entry after #3 would not read; walk on from it with --from');
      expect(linesIn(cwd).map((entry) => entry.dex)).toStrictEqual([1, 2, 3]);
    },
  );

  /**
   * A first tile that opens an entry whose title does not read, Bulbasaur's foot standing in for it. The entry is closed
   * before the next tile is tapped, which opens Ivysaur's, so the walk stops where the swipe back lands on the entry
   * that would not read rather than on finding no tile that opened one.
   */
  test(
    'closes an entry that opened with its title unread before tapping the next tile',
    { timeout: SLOW },
    async (context) => {
      const phone = new Pokedex([['bulbasaur-2'], ...ENTRIES.slice(1)]);
      const { inventory } = await harness(context, phone, ['Bulbasaur', 'Ivysaur', 'Venusaur'], KANTO_ICONS);
      const { code, stderr } = await inventory('dex', '--from', '1', '--to', '3');

      expect(code).toBe(1);
      expect(stderr).toContain('the entry before #2 would not read; walk on from it with --from');
    },
  );

  /**
   * A range past the last species the phone has seen, which on this one is anything from #4: no tile from there opens
   * an entry, so the walk lands on the last one before it that does, Venusaur. That is outside the range, and a line
   * for it would stand beside the one a record already keeps for it.
   *
   * Begun on the SHINY tab's grid, where the POKÉMON tab in the strip reads as the main menu's label does: the grid is
   * left by its REGIONS button rather than tapped as if it were the menu.
   */
  test(
    'writes nothing for a range past the last species seen, rather than that species again',
    { timeout: SLOW },
    async (context) => {
      const phone = new Pokedex();
      [phone.screen, phone.tab] = ['grid', 1];
      const { cwd, inventory } = await harness(context, phone, ['Bulbasaur', 'Ivysaur', 'Venusaur'], KANTO_ICONS);
      const { stderr } = await inventory('dex', '--from', '4', '--to', '10');

      expect(stderr).toContain('Nothing from #4 on has been seen, the last species seen before it being #3');
      expect(stderr).toContain('Wrote 0 species to pokedex.jsonl');
      expect(existsSync(join(cwd, 'pokedex.jsonl')), 'a line was written for a species outside the range').toBe(false);
    },
  );
});
