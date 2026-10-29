/**
 * The phone over WebUSB, as a `Transport` for the same `Device` `pnpm inventory` drives through the `adb` binary. Built
 * on [Tango](https://tangoadb.dev/) (`@yume-chan/adb`, MIT), which speaks the ADB protocol from the page itself: the
 * phone is picked through the browser's own device chooser and no `adb` is installed anywhere.
 *
 * The computer has to be authorised on the phone the first time, as it does for `adb`. The key that authorisation is
 * for is made by Web Crypto and kept in this site's IndexedDB, so it is this browser that is trusted rather than the
 * machine — another browser, or this one with its site data cleared, asks again.
 */

import { Adb, AdbDaemonTransport } from '@yume-chan/adb';
import AdbWebCredentialStore from '@yume-chan/adb-credential-web';
import { AdbDaemonWebUsbDevice, AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-daemon-webusb';

import { type Transport } from '../tools/inventory/adb.mts';

/** What the exit status is printed behind on a phone without the shell protocol; see `legacy` in `open`. */
const EXIT_MARK = 'pogo-utils-exit:';

/**
 * Where `needle` last occurs in `bytes`, or -1: a byte search, the output it is run over being binary as often as not.
 */
function lastIndexOf(bytes: Uint8Array, needle: Uint8Array): number {
  for (let at = bytes.length - needle.length; at >= 0; at--) {
    if (needle.every((byte, i) => bytes[at + i] === byte)) {
      return at;
    }
  }

  return -1;
}

/**
 * A command's output with the exit status `legacy` printed after it cut back off, or a throw where that status is not
 * zero or never arrived. Searched for by bytes from the end, past anything the command itself wrote.
 */
export function statusCut(bytes: Uint8Array, command: readonly string[]): Uint8Array {
  const at = lastIndexOf(bytes, new TextEncoder().encode(`\n${EXIT_MARK}`));

  // Digits or nothing: a marker with the run cut off after it decodes to '', which `Number` would read as a clean 0.
  const digits = at < 0 ? '' : new TextDecoder().decode(bytes.subarray(at + EXIT_MARK.length + 1));
  const status = /^\d+$/.test(digits) ? Number(digits) : NaN;

  if (status !== 0) {
    throw new Error(`${command.join(' ')} exited ${Number.isNaN(status) ? 'without saying how' : status}`);
  }

  return bytes.subarray(0, at);
}

/** As long as `adb-cli.mts` waits on `adb`: far longer than any call here takes, so it fires only on a wedged phone. */
const TIMEOUT_MS = 30_000;

/**
 * Why this page cannot reach a phone, or null where it can. WebUSB needs a secure context, which is `localhost` and the
 * published site but not the LAN address `pnpm serve` prints; and it is a Chromium API, so Firefox and Safari have
 * none.
 */
function unreachable(): string | null {
  // The global rather than `window`'s, which a Worker has none of.
  if (!globalThis.isSecureContext) {
    return (
      'WebUSB needs a secure context: ' +
      'open this page from localhost or the published site rather than a LAN address.'
    );
  }

  if (AdbDaemonWebUsbDeviceManager.BROWSER === undefined) {
    return 'This browser has no WebUSB. Chrome and Edge do, on a computer or on Android.';
  }

  return null;
}

/**
 * Lets go of a connection no transport was built on, as where authentication fails: Tango releases its locks on the
 * streams but closes nothing, which would leave the phone's ADB interface claimed by this page until it is reloaded —
 * and the `adb kill-server` advice for a busy phone useless. Closing either stream closes the device and drops the
 * listener for it being unplugged; both are tried, as one may already have errored, and neither failing is worth more
 * than the error that brought the caller here.
 */
export async function release(connection: {
  readable: { cancel(): Promise<void> };
  writable: { close(): Promise<void> };
}): Promise<void> {
  await connection.writable.close().catch(() => undefined);
  await connection.readable.cancel().catch(() => undefined);
}

/** A process on the phone, its stdin held open and its stdout apart from its stderr. */
export interface Process {
  stdin: WritableStream<Uint8Array>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  kill(): void;
}

/**
 * A phone this context holds a connection to, the page or a battle's Worker, with what the chooser called it where it
 * was picked there.
 */
export interface Phone {
  name: string;

  /** What `reconnect` finds it again by, once the connection has been let go. */
  serial: string;
  transport: Transport;

  /**
   * `command` started and left running, for what a `Transport` cannot do: a recording read as it comes, and a shell
   * written to command after command. By the shell protocol, which keeps a recording's stderr out of its H.264, and
   * which any phone Pokémon GO runs on has, it being Android 7's.
   */
  spawn(command: readonly string[]): Promise<Process>;
  close(): Promise<void>;

  /** Settles once the connection is over: resolving where it was closed, rejecting where the phone was unplugged. */
  disconnected: Promise<void>;
}

/** WebUSB, or a throw saying why this page has none. */
function usb(): AdbDaemonWebUsbDeviceManager {
  const manager = AdbDaemonWebUsbDeviceManager.BROWSER;

  if (manager === undefined) {
    throw new Error(unreachable() ?? 'This browser has no WebUSB.');
  }

  return manager;
}

/**
 * Offers the browser's device chooser and connects to whatever is picked, or answers null where the chooser was
 * dismissed. Only ADB interfaces are offered, Tango's default filter being the class ADB declares.
 */
export async function connect(): Promise<Phone | null> {
  const device = await usb().requestDevice();

  return device === undefined ? null : open(device);
}

/**
 * Connects to the phone `serial` names without the chooser, which only one the page was granted before can be: what a
 * battle's Worker reaches the phone by once the page has let it go, and what the page takes it back by after. The
 * permission is the origin's rather than the document's, so a Worker is granted what its page was, and the key
 * authorising this browser is in the origin's IndexedDB, so neither asks the phone again.
 */
export async function reconnect(serial: string): Promise<Phone> {
  const device = (await usb().getDevices()).find((candidate) => candidate.serial === serial);

  if (device === undefined) {
    throw new Error(`the phone ${serial} is not plugged in, or this site may no longer reach it`);
  }

  return open(device);
}

/**
 * The phone `device` is, connected and authenticated. A phone already held cannot be claimed twice, which is the
 * commonest way for this to fail and so is the one said in full: usually by the `adb` server on this machine, but on
 * `reconnect` it can be this site's own battle Worker, not yet done letting it go, or the site in another tab.
 */
async function open(device: AdbDaemonWebUsbDevice): Promise<Phone> {
  let connection;

  try {
    connection = await device.connect();
  } catch (error) {
    if (error instanceof AdbDaemonWebUsbDevice.DeviceBusyError) {
      throw new Error(
        'the phone is held by something else: usually an adb server on this computer, which `adb kill-server` stops, ' +
          'or this site in another tab or a battle still letting it go; try again once it is free',
        { cause: error },
      );
    }

    throw error;
  }

  let transport;

  try {
    transport = await AdbDaemonTransport.authenticate({
      serial: device.serial,
      connection,
      credentialStore: new AdbWebCredentialStore('pogo-utils'),
    });
  } catch (error) {
    await release(connection);
    throw error;
  }

  const adb = new Adb(transport);

  /**
   * A command's output, given up on after `TIMEOUT_MS` as `adb-cli.mts` gives up on `adb`: a phone that stops answering
   * fails the one call loudly rather than leaving the page waiting on it. The command itself cannot be called back, so
   * what is given up on is the wait, and a phone that wedged is one to reconnect.
   */
  const run = (command: readonly string[]): Promise<Uint8Array> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(`${command.join(' ')}: no answer after ${TIMEOUT_MS / 1000}s; is the phone still connected?`),
          ),
        TIMEOUT_MS,
      );
    });

    return Promise.race([output(command), late]).finally(() => clearTimeout(timer));
  };

  /**
   * A command's output over the protocol older phones have, which carries one stream and no exit status. So stderr is
   * sent to `/dev/null`, where it cannot land in the middle of a PNG, and the status is printed after the output on a
   * line of its own — a newline, a marker and the number — then cut back off and held to zero, as the shell protocol's
   * is. A binary stdout is unharmed: the marker is found from the end, past anything the command wrote.
   */
  const legacy = async (command: readonly string[]): Promise<Uint8Array> => {
    const bytes = await adb.subprocess.noneProtocol.spawnWait(
      `${command.join(' ')} 2>/dev/null; printf '\\n${EXIT_MARK}%d' $?`,
    );
    return statusCut(bytes, command);
  };

  /**
   * A command's output, by the shell protocol where the phone has it — Android 7 on — which keeps stderr out of what is
   * answered and says how the command exited. The older protocol interleaves the two, which for a screenshot would put
   * a warning in the middle of a PNG; it is the fallback rather than the rule.
   */
  const output = async (command: readonly string[]): Promise<Uint8Array> => {
    const shell = adb.subprocess.shellProtocol;

    if (shell === undefined) {
      return legacy(command);
    }

    const { stdout, stderr, exitCode } = await shell.spawnWait(command);

    if (exitCode !== 0) {
      throw new Error(`${command.join(' ')} exited ${exitCode}: ${new TextDecoder().decode(stderr).trim()}`);
    }

    return stdout;
  };

  // Tango types its streams as its own polyfill's, which are the platform's at run time.
  const spawn = async (command: readonly string[]): Promise<Process> => {
    const shell = adb.subprocess.shellProtocol;

    if (shell === undefined) {
      throw new Error("this phone's adb has no shell protocol, which Android has had since 7");
    }

    const process = await shell.spawn(command);

    return {
      stdin: process.stdin as unknown as WritableStream<Uint8Array>,
      stdout: process.stdout as unknown as ReadableStream<Uint8Array>,
      stderr: process.stderr as unknown as ReadableStream<Uint8Array>,
      kill: () => void Promise.resolve(process.kill()).catch(() => undefined),
    };
  };

  return {
    name: device.name || device.serial,
    serial: device.serial,
    transport: {
      // Authenticated is what `adb get-state` calls `device`; a phone that refused the key never gets this far.
      state: () => Promise.resolve('device'),

      shell: run,
      screencap: () => run(['screencap', '-p']),
    },
    spawn,
    close: () => adb.close(),
    disconnected: adb.disconnected,
  };
}
