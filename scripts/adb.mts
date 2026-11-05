/**
 * Things done to an Android phone over `adb` that neither `pnpm inventory` nor `pnpm battle` does for itself.
 *
 * Usage, from the repository root, with the phone plugged in and USB debugging on:
 *
 *   pnpm adb screen-off [--serial SERIAL]
 *                       turn the phone's panel off beneath Android, to spare an OLED a long battle's still HUD. The
 *                       game goes on drawing, `screenrecord` on recording and touches on landing as if it were lit,
 *                       since Android is not told. It stays dark until `screen-on`, or until the phone sleeps and is
 *                       woken, which Pokémon GO's own wake lock puts off for as long as the game is in front
 *   pnpm adb screen-on [--serial SERIAL]
 *                       turn it back on
 *   `help`, or `--help` beside any command, prints this.
 */

import { said } from '../src/errors.ts';
import { screenPower } from '../src/tools/adb/screen-power.mts';
import { adbCli } from '../src/tools/inventory/adb-cli.mts';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    serial: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});

const [command = 'help', ...rest] = options.help ? [] : positionals;

/** The synopsis out of this file's own header, as `inventory.mts` reads its own. */
const USAGE = readFileSync(new URL(import.meta.url), 'utf8')
  .match(/Usage[^]*?(?=\n \*\/)/)?.[0]
  .replace(/^ \* ?/gm, '');

const power = command === 'screen-off' ? 'off' : command === 'screen-on' ? 'on' : undefined;

if (power && rest.length === 0) {
  const dex = readFileSync(new URL('../src/tools/adb/screen-power/ScreenPower.dex', import.meta.url));

  try {
    await screenPower(adbCli(options.serial), dex, power);
  } catch (error) {
    console.error(said(error));
    process.exitCode = 1;
  }
} else {
  (command === 'help' ? console.log : console.error)(USAGE);
  process.exitCode = command === 'help' ? 0 : 1;
}
