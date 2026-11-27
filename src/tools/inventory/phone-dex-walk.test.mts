/**
 * `pnpm inventory dex` walking the first three entries on the phone `test-pokedex.mts` models: the lines it writes and
 * the counts it checks them against.
 */

import { SIZES } from './pokedex.mts';
import { harness, recording, SLOW } from './node/test-phone.mts';
import {
  agreeing,
  countsIn,
  ENTRIES,
  FIRST_THREE,
  KANTO_ICONS,
  linesIn,
  LISTS,
  Pokedex,
} from './node/test-pokedex.mts';
import { decodePng } from '../../core/png.mts';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

describe('dex', () => {
  test(
    'walks the first three entries, writes a line for each, and fails the count against a record of only those',
    { timeout: SLOW },
    async (context) => {
      // A fourth entry that would not read, which a walk to #3 has no reason to swipe to.
      const phone = new Pokedex([...ENTRIES, ['menu']]);
      const { cwd, inventory } = await harness(context, phone, ['Bulbasaur', 'Ivysaur', 'Venusaur'], KANTO_ICONS);
      const { code, stderr } = await inventory('dex', '--from', '1', '--to', '3');

      expect(linesIn(cwd)).toStrictEqual(FIRST_THREE);
      expect(stderr).toContain('Wrote 3 species to pokedex.jsonl');

      // Every region the lists print disagrees with a record of three species, Kanto's own included, and the lines it
      // wrote are kept for all that.
      expect(code).toBe(1);
      expect(stderr).toContain('POKÉMON in Kanto: the game counts 148, the record 3');

      // And every region whose card did not read on the POKÉMON tab's captures is said rather than passed as agreeing:
      // the tab lists all of them, so each it did not read is one the record was not checked against.
      const shown = await Promise.all(
        (LISTS[0] ?? []).map(async (frame) => countsIn(decodePng(recording(`pokedex/${frame}.png`)))),
      );
      const read = new Set(shown.flat().map((c) => c.region));
      const said = /^ {2}POKÉMON: no count read for (.*), so the record there was not checked$/m.exec(stderr)?.[1];

      expect((said?.split(', ') ?? []).sort()).toStrictEqual([...SIZES.keys()].filter((r) => !read.has(r)).sort());
      expect(stderr).toMatch(
        /the record disagrees with the game in \d+ places; every line read is kept in pokedex\.jsonl/,
      );
    },
  );

  /**
   * A record agreeing with the game but for the first three, walked from 1 to 10 on a phone whose swipe from the third
   * goes nowhere: each species read replaces its line, and the lines the walk never reached, 4 to 10 among them, stay
   * as they were, since a walk ending there is what a swipe the phone dropped looks like too.
   */
  test(
    "replaces the lines it reads and leaves those it never reached, passing a record that agrees with the game's",
    { timeout: SLOW },
    async (context) => {
      const phone = new Pokedex();
      const { cwd, inventory } = await harness(context, phone, ['Bulbasaur', 'Ivysaur', 'Venusaur'], KANTO_ICONS);
      const record = await agreeing();

      // The first three as some earlier run had them, wrong, which is what the walk has to replace.
      const stale = record.map((entry) => (entry.dex <= 3 ? { ...entry, caught: false, forms: [] } : entry));
      writeFileSync(join(cwd, 'pokedex.jsonl'), stale.map((entry) => `${JSON.stringify(entry)}\n`).join(''));

      const { code, stderr } = await inventory('dex', '--from', '1', '--to', '10');

      expect(
        record.filter((entry) => entry.dex > 3 && entry.dex <= 10),
        'nothing unreached to keep',
      ).not.toStrictEqual([]);

      expect({ code, mismatched: stderr.match(/^ {2}.* in .*: the game counts .*$/gm) }).toStrictEqual({
        code: 0,
        mismatched: null,
      });
      expect(linesIn(cwd)).toStrictEqual(record);
    },
  );
});
