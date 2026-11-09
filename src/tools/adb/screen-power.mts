/**
 * The phone's panel dark or lit, for `pnpm adb screen-off` and `screen-on`, which spares an OLED a long battle's still
 * HUD: `ScreenPower.dex`, built out of the Java beside it, written to the phone through the shell and run by
 * `app_process`. The panel goes dark beneath Android rather than the phone going to sleep, so the game, `screenrecord`
 * and the touchscreen carry on as if it were lit: a Master League set on a Pixel 4 XL with Android 13 went 4–1 under
 * scrcpy's `--turn-screen-off`, which makes the same call.
 *
 * The dex is committed, so that neither this, the site's build nor `pnpm lint` needs a JDK: `scripts/build-dex.mts`
 * builds it with JDK 21's `javac` and a pinned D8, and `pnpm lint:dex`, left out of `pnpm lint` and run on its own in
 * CI, fails where the two differ, since another JDK's `javac` may write other bytes.
 *
 * Through nothing but `shell`, as `src/battle/awake.ts` is, so that a page could run it over WebUSB as well.
 */

import { type Transport } from '../../core/adb.mts';

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

  await transport
    .shell([
      ...['echo', encoded, '|', 'base64', '-d', '>', PATH],
      ...['&&', `CLASSPATH=${PATH}`, 'app_process', '/', 'ScreenPower', power],
    ])
    .catch((error: unknown) => {
      // A transport's error repeats the command, whose dex would bury what the phone said under 4 KB of base64.
      throw error instanceof Error ? new Error(error.message.replace(encoded, '…'), { cause: error }) : error;
    });
}
