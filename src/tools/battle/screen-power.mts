/**
 * The phone's screen dark for a battle, which spares an OLED panel the battle's still HUD: `ScreenPower.dex`, built by
 * `scripts/build-dex.mts` out of the Java beside it, written to the phone through the shell and run by `app_process`.
 * The panel goes dark beneath Android rather than the phone going to sleep, so the game, `screenrecord` and the
 * touchscreen carry on as if it were lit: a Master League set on a Pixel 4 XL with Android 13 went 4–1 under scrcpy's
 * `--turn-screen-off`, which makes the same call.
 *
 * Through nothing but `shell`, as `src/battle/awake.ts` is, so that a page could run it over WebUSB as well.
 */

import { type Transport } from '../inventory/adb.mts';

/** Where the dex is written: the shell user's own directory, which it may both write to and run from. */
const PATH = '/data/local/tmp/pogo-utils-screen-power.dex';

/**
 * Turns the panel `off` or `on` through `transport`, writing `dex` to the phone first, since nothing guarantees one
 * written by an earlier run is still there or still this one. Throws with what the phone wrote where it fails.
 */
export async function screenPower(
  transport: Pick<Transport, 'shell'>,
  dex: Uint8Array,
  power: 'off' | 'on',
): Promise<void> {
  // Base64's letters are all safe to the phone's shell unquoted, and some 4 KB of them go in one command.
  const encoded = btoa(String.fromCharCode(...dex));

  await transport.shell([
    ...['echo', encoded, '|', 'base64', '-d', '>', PATH],
    ...['&&', `CLASSPATH=${PATH}`, 'app_process', '/', 'ScreenPower', power],
  ]);
}
