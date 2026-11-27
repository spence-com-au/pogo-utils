/** `pnpm inventory dex` finding its way from the map into the Pokédex, on the phone `test-pokedex.mts` models. */

import { harness, SLOW } from './node/test-phone.mts';
import { ENTRIES, KANTO_ICONS, Pokedex, POPUPS } from './node/test-pokedex.mts';
import { KEY } from '../../core/adb.mts';
import { describe, expect, test } from 'vitest';

describe('dex', () => {
  /**
   * Two pop-ups over the map, each of which takes the main menu's tap and does nothing with it (#1046). Each is put off
   * with its LATER, which is the only tap the phone answers on one, and the walk goes on from the map beneath them over
   * the same range as the test above, which gets as far as the grid and no further.
   */
  test(
    'puts off the pop-ups over the map with their LATER and walks on from it',
    { timeout: SLOW },
    async (context) => {
      const phone = new Pokedex(ENTRIES, POPUPS);
      const { inventory } = await harness(context, phone, ['Bulbasaur', 'Ivysaur', 'Venusaur'], KANTO_ICONS);
      const { stderr } = await inventory('dex', '--from', '4', '--to', '10');

      expect(stderr).toContain('Nothing from #4 on has been seen, the last species seen before it being #3');
      expect(stderr.match(/a pop-up was over the map; putting it off with its LATER/g)).toHaveLength(POPUPS.length);
      expect(phone.calls).not.toContain(`shell input keyevent ${KEY.BACK}`);
    },
  );

  /**
   * A first tap on the main menu's button that the phone drops, leaving the map as it was with the button drawn where
   * it was (#1058). The walk taps it again and goes on over the same range as the test above.
   */
  test('taps the main menu again where the phone dropped the tap', { timeout: SLOW }, async (context) => {
    const phone = new Pokedex();
    phone.menuTaps.push(null);
    const { inventory } = await harness(context, phone, ['Bulbasaur', 'Ivysaur', 'Venusaur'], KANTO_ICONS);
    const { stderr } = await inventory('dex', '--from', '4', '--to', '10');

    expect(stderr).toContain('Nothing from #4 on has been seen, the last species seen before it being #3');
    expect(stderr.match(/the main menu did not open, the map left as it was; tapping it again/g)).toHaveLength(1);
  });

  /**
   * A tap on the main menu's button that opens something else, a dialog standing in for the stop a walking avatar
   * carried under the button, which draws something else where the button was. A second tap there would be a guess at
   * a screen the walk knows nothing of, so it stops having made only the one.
   */
  test(
    'stops where a tap on the main menu opened something else, without tapping again',
    { timeout: SLOW },
    async (context) => {
      const phone = new Pokedex();
      phone.menuTaps.push('dialog/persian-power-up.png');
      const { inventory } = await harness(context, phone, ['Bulbasaur', 'Ivysaur', 'Venusaur'], KANTO_ICONS);
      const { code, stderr } = await inventory('dex', '--from', '4', '--to', '10');

      expect(code).toBe(1);
      expect(stderr).toContain('the main menu did not open; open the Pokédex by hand and run again');
      expect(phone.calls.filter((call) => call.startsWith('shell input tap'))).toHaveLength(1);
    },
  );
});
