/**
 * The `adb` binary as a `Transport`. `adbCli`, which is how `pnpm inventory` reaches the phone, makes each call a fresh
 * `adb` process, which costs a few tens of milliseconds against animations that take most of a second and means a
 * dropped USB connection fails one call loudly. `adbHeld`, which is how `pnpm battle` reaches it, writes its shell
 * commands to one `adb shell` held open, a battle's swipes coming too fast to start a process for each.
 */

import { type Transport } from './adb.mts';
import { holdShell } from './held-shell.mts';
import { execFile, spawn } from 'node:child_process';

/**
 * Far longer than any call here takes, so it only fires on a device or `adb` server that has wedged — an `offline`
 * phone, a stalled USB link — which would otherwise hang the scan rather than fail the one call.
 */
const TIMEOUT_MS = 30_000;

/** The phone `serial` names, or the only one plugged in where it names none. */
export function adbCli(serial?: string): Transport {
  const prefix = serial ? ['-s', serial] : [];

  const adb = (args: readonly string[]): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      execFile(
        'adb',
        [...prefix, ...args],
        { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, timeout: TIMEOUT_MS },
        (error, stdout, stderr) => {
          if (error) {
            const detail = error.killed
              ? `no answer after ${TIMEOUT_MS / 1000}s; is the phone still connected?`
              : stderr.toString().trim() || error.message;
            reject(new Error(`adb ${args.join(' ')}: ${detail}`));
          } else {
            resolve(stdout);
          }
        },
      );
    });

  return {
    state: async () => (await adb(['get-state'])).toString(),
    shell: (args) => adb(['shell', ...args]),
    screencap: () => adb(['exec-out', 'screencap', '-p']),
  };
}

/**
 * As `adbCli`, but with shell commands written one after another to a single `adb shell` held open, as `held-shell.mts`
 * holds one, which is how `pnpm battle` reaches the phone: a fresh `adb` process for each of its six swipes a second
 * cost a median 50ms over a Training battle on a Pixel 4 XL, against a fast move's 80ms swipe. The state, being no shell
 * command, and the screenshot, being binary, stay a process each.
 */
export function adbHeld(serial?: string): Transport & { close(): void } {
  const prefix = serial ? ['-s', serial] : [];
  const cli = adbCli(serial);
  const child = spawn('adb', [...prefix, 'shell'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let errors = '';

  const held = holdShell(
    {
      write: (text) => child.stdin.write(text),
      end: () => child.stdin.end(),
      kill: () => child.kill(),
    },
    'adb shell',
  );

  child.stdout.on('data', (chunk: Buffer) => held.output(chunk));

  // What `adb` itself writes, such as why it lost the phone, the phone's own stderr coming on stdout.
  child.stderr.on('data', (chunk: Buffer) => (errors += chunk.toString()));
  child.stdin.on('error', (error) =>
    held.fail(new Error(`adb shell: ${error.message}; is the phone still connected?`)),
  );
  child.on('error', (error) => held.fail(new Error(`adb shell: ${error.message}`)));

  // `close` rather than `exit`: it waits for both streams to end, so a marker or a reason adb wrote is not lost.
  child.on('close', () => held.exited(errors.trim()));

  return {
    state: () => cli.state(),
    shell: held.shell,
    screencap: () => cli.screencap(),
    close: held.close,
  };
}
