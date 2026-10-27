/**
 * The `adb` binary as a `Transport`. `adbCli`, which is how `pnpm inventory` reaches the phone, makes each call a fresh
 * `adb` process, which costs a few tens of milliseconds against animations that take most of a second and means a
 * dropped USB connection fails one call loudly. `adbHeld`, which is how `pnpm battle` reaches it, writes its shell
 * commands to one `adb shell` held open, a battle's swipes coming too fast to start a process for each.
 */

import { type Transport } from './adb.mts';
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
 * As `adbCli`, its arguments joined with spaces for the phone's shell to read as `adb shell` joins them, but with shell
 * commands written one after another to a single `adb shell` held open, which is how `pnpm battle` reaches the phone: a
 * fresh `adb` process for each of its six swipes a second cost a median 50ms over a Training battle on a Pixel 4 XL,
 * against a fast move's 80ms swipe. Each command's end is a marker line the shell prints after it with its exit status,
 * which no command's own output carries. The phone's shell writes stderr to stdout, so that what a command wrote to
 * either comes back in order ahead of its marker and is all its own: a command that fails is told by what it wrote, and
 * one that succeeds answers that too, as its output, where a separate stderr would arrive on its own pipe in either
 * order. The state, being no shell command, and the screenshot, being binary, stay a process each.
 *
 * A dropped connection must still fail loudly rather than leave commands written into nothing: the shell closing, a
 * write to it failing, or a command going unanswered for `TIMEOUT_MS` fails the command under way and every one after
 * it. `close` ends the shell once nothing more is to be sent, and anything sent after fails at once.
 */
export function adbHeld(serial?: string): Transport & { close(): void } {
  const prefix = serial ? ['-s', serial] : [];
  const cli = adbCli(serial);
  const child = spawn('adb', [...prefix, 'shell'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const marker = `__adb_held_${process.pid}_${Date.now()}__`;
  let output = Buffer.alloc(0);
  let errors = '';
  let dead: Error | undefined;
  let closing = false;
  let queue: Promise<unknown> = Promise.resolve();

  let current: { resolve: (out: Buffer) => void; reject: (error: Error) => void; timer: NodeJS.Timeout } | undefined;

  const die = (error: Error) => {
    dead ??= error;
    current?.reject(dead);
    clearTimeout(current?.timer);
    current = undefined;
  };

  child.stdout.on('data', (chunk: Buffer) => {
    output = Buffer.concat([output, chunk]);

    // `\n<marker> <status>\n`: the newline before it is the shell's, put there in case the output ended without one.
    const at = output.indexOf(`\n${marker} `);
    const end = at < 0 ? -1 : output.indexOf('\n', at + 1);

    if (current && end >= 0) {
      const status = Number(output.subarray(at + marker.length + 2, end).toString());
      const out = output.subarray(0, at);
      const { resolve, reject, timer } = current;

      output = output.subarray(end + 1);
      clearTimeout(timer);
      current = undefined;

      if (status === 0) {
        resolve(out);
      } else {
        reject(new Error(out.toString().trim() || `exited ${status}`));
      }
    }
  });

  // What `adb` itself writes, such as why it lost the phone, the phone's own stderr coming on stdout.
  child.stderr.on('data', (chunk: Buffer) => (errors += chunk.toString()));
  child.stdin.on('error', (error) => die(new Error(`adb shell: ${error.message}; is the phone still connected?`)));
  child.stdin.write('exec 2>&1\n');
  child.on('error', (error) => die(new Error(`adb shell: ${error.message}`)));

  // `close` rather than `exit`: it waits for both streams to end, so a marker or a reason adb wrote is not lost.
  child.on('close', () =>
    die(
      new Error(
        closing
          ? 'adb shell closed'
          : `adb shell exited${errors.trim() ? `: ${errors.trim()}` : ''}; is the phone still connected?`,
      ),
    ),
  );

  const shell = (args: readonly string[]): Promise<Buffer> => {
    const run = queue.then(
      () =>
        new Promise<Buffer>((resolve, reject) => {
          if (dead || closing) {
            reject(dead ?? new Error('adb shell closed'));
            return;
          }

          const timer = setTimeout(() => {
            die(new Error(`no answer after ${TIMEOUT_MS / 1000}s; is the phone still connected?`));
            child.kill();
          }, TIMEOUT_MS);

          current = { resolve, reject, timer };

          // `echo` rather than `printf`, which is no builtin of the phone's shell but a process of its own, 14ms a call.
          // The marker on a line of its own, so that a `#` in the command comments out none of it. One `echo` for the
          // newline before it and the marker both, since two small writes in a row can wait on the `adb` client's
          // delayed ACK of the first: 1 command in 6 answered 40ms late, through 300 swipes on a Pixel 4 XL, as two.
          child.stdin.write(`${args.join(' ')}\ns=$?; echo "\n${marker} $s"\n`);
        }),
    );

    queue = run.catch(() => undefined);

    // A command cut short where it runs on, as a swipe's hundreds of escaped bytes do: its start tells which it was.
    const command = args.join(' ');
    const shown = command.length > 60 ? `${command.slice(0, 60)}…` : command;

    return run.catch((error: unknown) => {
      throw new Error(`adb shell ${shown}: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  return {
    state: () => cli.state(),
    shell,
    screencap: () => cli.screencap(),
    close: () => {
      closing = true;
      child.stdin.end();
    },
  };
}
