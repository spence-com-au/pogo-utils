/**
 * One shell held open on the phone, commands written to it one after another, apart from whatever carries its bytes:
 * the `adb` binary's `adb shell` in `adb-cli.mts`, and Tango's process over WebUSB in a page. Each command's end is a
 * marker line the shell prints after it with its exit status, which no command's own output carries. The shell writes
 * stderr to stdout, so that what a command wrote to either comes back in order ahead of its marker and is all its own:
 * a command that fails is told by what it wrote, and one that succeeds answers that too, as its output, where a
 * separate stderr would arrive on its own stream in either order.
 *
 * A dropped connection must still fail loudly rather than leave commands written into nothing: the shell ending, a
 * write to it failing, or a command going unanswered for `TIMEOUT_MS` fails the command under way and every one after
 * it. `close` ends the shell once nothing more is to be sent, and anything sent after fails at once.
 */

/**
 * Far longer than any call here takes, so it only fires on a device or `adb` server that has wedged — an `offline`
 * phone, a stalled USB link — which would otherwise hang the battle rather than fail the one call.
 */
const TIMEOUT_MS = 30_000;

/** How the shell's stdin is reached: written to, ended once nothing more is to be sent, and stopped outright. */
export interface Pipe {
  write(text: string): void;
  end(): void;
  kill(): void;
}

export interface HeldShell {
  /** A command's output, its arguments joined with spaces for the shell to read as `adb shell` joins them. */
  shell(args: readonly string[]): Promise<Uint8Array>;
  close(): void;

  /** What the shell wrote to its stdout, as it comes. */
  output(chunk: Uint8Array): void;

  /** The connection failing, which fails the command under way and every one after it. */
  fail(error: Error): void;

  /** The shell having ended, with what its carrier wrote of why, where it wrote anything. */
  exited(detail: string): void;
}

/** Where `needle` first occurs in `bytes`, or -1: its first byte found natively, and the rest compared there. */
function indexOf(bytes: Uint8Array, needle: Uint8Array): number {
  for (let at = bytes.indexOf(needle[0] ?? 0); at >= 0; at = bytes.indexOf(needle[0] ?? 0, at + 1)) {
    if (needle.every((byte, i) => bytes[at + i] === byte)) {
      return at;
    }
  }

  return -1;
}

export function holdShell(pipe: Pipe): HeldShell {
  const encoder = new TextEncoder();
  const marker = `__held_shell_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
  const lead = encoder.encode(`\n${marker} `);
  let output = new Uint8Array(0);
  let dead: Error | undefined;
  let closing = false;
  let queue: Promise<unknown> = Promise.resolve();

  let current:
    | { resolve: (out: Uint8Array) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
    | undefined;

  const fail = (error: Error) => {
    dead ??= error;
    current?.reject(dead);
    clearTimeout(current?.timer);
    current = undefined;
  };

  const heard = (chunk: Uint8Array) => {
    const joined = new Uint8Array(output.length + chunk.length);
    joined.set(output);
    joined.set(chunk, output.length);
    output = joined;

    // `\n<marker> <status>\n`: the newline before it is the shell's, put there in case the output ended without one.
    const at = indexOf(output, lead);
    const end = at < 0 ? -1 : output.indexOf(0x0a, at + lead.length);

    if (current && end >= 0) {
      const status = Number(new TextDecoder().decode(output.subarray(at + lead.length, end)));
      const out = output.subarray(0, at);
      const { resolve, reject, timer } = current;

      output = output.subarray(end + 1);
      clearTimeout(timer);
      current = undefined;

      if (status === 0) {
        resolve(out);
      } else {
        reject(new Error(new TextDecoder().decode(out).trim() || `exited ${status}`));
      }
    }
  };

  const shell = (args: readonly string[]): Promise<Uint8Array> => {
    const run = queue.then(
      () =>
        new Promise<Uint8Array>((resolve, reject) => {
          if (dead || closing) {
            reject(dead ?? new Error('adb shell closed'));
            return;
          }

          const timer = setTimeout(() => {
            fail(new Error(`no answer after ${TIMEOUT_MS / 1000}s; is the phone still connected?`));
            pipe.kill();
          }, TIMEOUT_MS);

          current = { resolve, reject, timer };

          // `echo` rather than `printf`, which is no builtin of the phone's shell but a process of its own, 14ms a call.
          // The marker on a line of its own, so that a `#` in the command comments out none of it. One `echo` for the
          // newline before it and the marker both, since two small writes in a row can wait on the `adb` client's
          // delayed ACK of the first: 1 command in 6 answered 40ms late, through 300 swipes on a Pixel 4 XL, as two.
          pipe.write(`${args.join(' ')}\ns=$?; echo "\n${marker} $s"\n`);
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

  pipe.write('exec 2>&1\n');

  return {
    shell,
    close: () => {
      closing = true;
      pipe.end();
    },
    output: heard,
    fail,
    exited: (detail) =>
      fail(
        new Error(
          closing
            ? 'adb shell closed'
            : `adb shell exited${detail ? `: ${detail}` : ''}; is the phone still connected?`,
        ),
      ),
  };
}
