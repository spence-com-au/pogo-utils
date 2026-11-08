/**
 * `stay_on_while_plugged_in`, which keeps the phone awake through a battle: a screen gone dark mid-battle reads as
 * nothing recognised and ends the run. `pnpm battle` and the Battle tab's Worker both read it, set it and put it back
 * as found through these, and each keeps the value found its own way: the CLI for its signal handler, the Worker in
 * IndexedDB ([`src/battle/awake.ts`](../../battle/awake.ts)). Through nothing but `shell`, so that a page can run it
 * over WebUSB as well.
 */

import { type Transport } from '../inventory/adb.mts';

type Shell = Pick<Transport, 'shell'>;

const SETTING = ['global', 'stay_on_while_plugged_in'] as const;

/** Whether `value` is the number Android stores, which is all that may go back through the shell, unquoted there. */
export const isStayOn = (value: unknown): value is string => typeof value === 'string' && /^\d+$/.test(value);

/** The setting as found, or `0`, off, where Android answers with anything but a number, as `null` where it is unset. */
export async function readStayOn(transport: Shell): Promise<string> {
  const read = new TextDecoder().decode(await transport.shell(['settings', 'get', ...SETTING])).trim();

  return isStayOn(read) ? read : '0';
}

/** Keeps the phone awake while it is plugged in, until the setting is put back. */
export const stayOnUsb = (transport: Shell) => transport.shell(['svc', 'power', 'stayon', 'usb']);

/** Puts the setting back to `value`, one `isStayOn` passes. */
export const putStayOn = (transport: Shell, value: string) => transport.shell(['settings', 'put', ...SETTING, value]);
