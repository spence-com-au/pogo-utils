/**
 * The phone, driven over ADB. Everything a scan or a battle asks of it is ten methods over one `Transport`, the only
 * part that differs between the CLI and the Inventory page: `adb-cli.mts` runs the `adb` binary, and
 * `src/inventory/webusb.ts` speaks the protocol over WebUSB from the page.
 */

import { decodePng, type Image } from './png.mts';

/**
 * How a `Device` reaches the phone: its state as `adb get-state` names it, a shell command's output, and a screenshot's
 * PNG. The screenshot is its own method because it is the one binary answer, and a transport has to keep it clear of
 * anything written to stderr — the CLI by `exec-out`, the page by the shell protocol.
 */
export interface Transport {
  state(): Promise<string>;
  shell(args: readonly string[]): Promise<Uint8Array>;
  screencap(): Promise<Uint8Array>;
}

/**
 * How long a transport waits on one call before failing it. Far longer than any call takes, so it only fires on a
 * device or `adb` server that has wedged — an `offline` phone, a stalled USB link — which would otherwise hang the scan
 * or the battle rather than fail the one call.
 */
export const TIMEOUT_MS = 30_000;

/** What a call given up on after `TIMEOUT_MS` fails with. */
export const NO_ANSWER = `no answer after ${TIMEOUT_MS / 1000}s; is the phone still connected?`;

/**
 * Whether `type` would send this rather than refuse it: a space, and the characters a storage search is made of —
 * `<` and `>` among them for the type-effectiveness searches, and `.` for Mr. Mime. `type` single-quotes the text, so
 * none of them reaches the shell as anything but itself; a `'` would end the quote, and is refused with the rest.
 * Exported so a caller can refuse a term before it has driven the phone to the box it meant to type into, `type`
 * throwing there leaving storage open with the keyboard up.
 */
export const typeable = (text: string) => /^[\w&,!@#*+<>.-]*$/.test(text.replaceAll(' ', ''));

/**
 * Whether `launch` would start this rather than refuse it: an Android package name, dot-separated segments that each
 * begin with a letter. Nothing in that grammar is read by the shell as anything but itself, so a name that fits needs
 * no quoting, and one that does not — a `--config` file's `"package": "x; reboot"` — never reaches the phone.
 */
export const launchable = (pkg: string) => /^[A-Za-z]\w*(\.[A-Za-z]\w*)+$/.test(pkg);

/** `pkg` where `launchable` passes it, and a refusal otherwise, before anything reaches the shell. */
function launching(pkg: string): string {
  if (!launchable(pkg)) {
    throw new Error(`refusing to launch ${JSON.stringify(pkg)}: only an Android package name is passed to the shell`);
  }

  return pkg;
}

/** The app in front: its package, and the Android user — the profile — whose copy of it that is. */
export interface Focus {
  package: string;
  user: number;
}

export class Device {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /** Fails with a readable message when there is no device, or more than one and no `--serial`. */
  async check(): Promise<void> {
    const state = (await this.#transport.state()).trim();

    if (state !== 'device') {
      throw new Error(`adb reports the phone as "${state}"; is USB debugging on and the computer authorised?`);
    }
  }

  async screenshot(): Promise<Image> {
    return decodePng(await this.#transport.screencap());
  }

  async tap([x, y]: readonly [number, number]): Promise<void> {
    await this.#shell('input', 'tap', String(Math.round(x)), String(Math.round(y)));
  }

  async swipe(from: readonly [number, number], to: readonly [number, number], ms = 300): Promise<void> {
    await this.#shell('input', 'swipe', ...[...from, ...to, ms].map((n) => String(Math.round(n))));
  }

  /** Typed into whatever has focus. `input text` takes `%s` for a space and nothing else survives the shell. */
  async type(text: string): Promise<void> {
    if (!typeable(text)) {
      throw new Error(`refusing to type ${JSON.stringify(text)}: only search-term characters are passed to the shell`);
    }

    await this.#shell('input', 'text', `'${text.replaceAll(' ', '%s')}'`);
  }

  async key(...codes: number[]): Promise<void> {
    await this.#shell('input', 'keyevent', ...codes.map(String));
  }

  /**
   * Starts `pkg` for Android user `user`, as the launcher would: its launcher activity, a task brought forward where one
   * is already running. The user is not optional because the phone's default is not a safe one. A work profile is a
   * user of its own, 10 where there is one, holding its own copy of every app installed there; `monkey`, which this was,
   * starts user 0's, so a game played in a work profile came back up signed in to whatever trainer the personal
   * profile's copy holds (#594). `am start` takes the user it is given, and the trailing package is the intent's own
   * rather than a component, so no activity name has to be known.
   */
  async launch(pkg: string, user: number): Promise<void> {
    await this.#shell(
      'am',
      'start',
      '--user',
      String(user),
      '-a',
      'android.intent.action.MAIN',
      '-c',
      'android.intent.category.LAUNCHER',
      '-f',
      '0x10200000',
      launching(pkg),
    );
  }

  /**
   * The Android users `pkg` is installed for, in the order `dumpsys package` lists them: one per profile holding a copy,
   * `[0]` on a phone with no work profile and `[0, 10]` on one that has the app in both. Each user is a line of the
   * package's dump, `User 10: ceDataInode=… installed=true hidden=false …`, and a user the package was uninstalled for
   * keeps its line with `installed=false`, so that is the field read rather than the line's presence.
   */
  async installs(pkg: string): Promise<number[]> {
    const dump = new TextDecoder().decode(await this.#shell('dumpsys', 'package', launching(pkg)));
    const users = [...dump.matchAll(/^\s*User (\d+):.*\binstalled=true\b/gm)].map(([, user]) => Number(user));

    // A package's dump lists each user once, but a phone that has the package as an update over a system image lists
    // the package twice, under `Packages:` and `Hidden system packages:`, users and all.
    return [...new Set(users)];
  }

  /**
   * The package of the window that has focus, and the Android user it runs as, which is how a caller can tell whether
   * the app it wants is in front without launching it to find out. `dumpsys window displays` is the cheapest place to
   * read it — 23 KB and 33ms against 72 KB for `dumpsys window` and 76 KB for `dumpsys activity activities`, all three
   * carrying the same single `mCurrentFocus` line.
   *
   * The user is the `u10` in `Window{81ff99a u10 com.example/.MainActivity}`, and is half the answer rather than a
   * detail: an app in a work profile and the same app in the personal profile have one package name and are different
   * installs, signed in to different accounts.
   *
   * A system window belongs to no package and so reads as null rather than as a name:
   * `Window{6b23334 u0 NotificationShade}` is what a phone reports once its screen has been off, against
   * `Window{81ff99a u0 com.example/.MainActivity}` for an app. Null therefore means no app is in front, which is the
   * question callers have — and not that the phone is locked, which this cannot answer: the keyguard fields in the same
   * dump read `isKeyguardShowing=false` over exactly that window.
   */
  async focused(): Promise<Focus | null> {
    const dump = new TextDecoder().decode(await this.#shell('dumpsys', 'window', 'displays'));
    const [, user, pkg] = /mCurrentFocus=Window\{\S+ u(\d+) ([\w.]+)\//.exec(dump) ?? [];

    return user === undefined || pkg === undefined ? null : { package: pkg, user: Number(user) };
  }

  /**
   * The views on the screen, as `uiautomator dump` writes them: XML of every view of the window in front, each with its
   * resource ID and bounds, which is where an app drawing views over a game's own, as PGSharp does, can be found. Some 4s
   * on a Pixel 4 XL. Written to `/dev/stdout` rather than the `/dev/tty` usually given, through a pipe: a shell held
   * open without a terminal, as the battle's is, has no tty, and its stdout is the connection, which `/dev/stdout`
   * cannot open again. Either way the dump said where it went with nothing before it.
   */
  async views(): Promise<string> {
    return new TextDecoder().decode(await this.#shell('uiautomator', 'dump', '/dev/stdout', '|', 'cat'));
  }

  #shell(...args: string[]): Promise<Uint8Array> {
    return this.#transport.shell(args);
  }
}

export const KEY = { BACK: 4, ENTER: 66, DEL: 67, MOVE_END: 123 } as const;
