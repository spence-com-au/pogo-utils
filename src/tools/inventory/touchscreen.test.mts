import { execFileSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { type Transport } from './adb.mts';
import { create, listed, report, swipe, touchscreen, write } from './touchscreen.mts';

/** `dumpsys input`'s InputReader entry for the device, as a Pixel 4 XL on Android 13 lists it. */
const LISTED = `  Device 5: pogo-utils touch
    EventHub Devices: [ 4 ]
    Generation: 95
    IsExternal: false
    AssociatedDisplayPort: <none>
    HasMic:     false
    Sources: 0x00001002
    KeyboardType: 0
`;

/** A phone's shell that answers `dumpsys input` with `dump`, keeping every command written to `/dev/uhid` otherwise. */
function phone(dump: string) {
  const commands: string[] = [];
  const transport: Transport = {
    state: () => Promise.resolve('device'),
    shell: (args) => {
      commands.push(args.join(' '));

      return Promise.resolve(new TextEncoder().encode(args.join(' ') === 'dumpsys input' ? dump : ''));
    },
    screencap: () => Promise.reject(new Error('no screenshots here')),
  };

  return { transport, commands };
}

/** The bytes a command from `write` hands the device, as the shell's `\0nnn` escapes read, which POSIX `%b` shares. */
function written(command: string): Uint8Array {
  expect(command).toMatch(/^print -nu3 '[^']*'$/);

  return execFileSync('sh', ['-c', command.replace('print -nu3', 'printf %b')]);
}

test('writes every byte through the shell as it is, NUL and all', () => {
  for (const event of [create(), report(true, [0.25, 0.75])]) {
    expect(written(write(event))).toEqual(Buffer.from(event));
  }
});

test('reports a point as fractions of the range, clamped to its edges', () => {
  const at = (down: boolean, point: readonly [number, number]) => {
    const view = new DataView(report(down, point).buffer);

    return { down: view.getUint8(7), x: view.getUint16(9, true), y: view.getUint16(11, true) };
  };

  expect(at(true, [0.5, 0.25])).toEqual({ down: 1, x: 0x4000, y: 0x2000 });
  expect(at(false, [1, -0.1])).toEqual({ down: 0, x: 0x7fff, y: 0 });
});

test('is ready once Android lists it as a touchscreen, and not as anything else', () => {
  expect(listed(LISTED)).toBe(true);
  expect(listed(LISTED.replace('0x00001002', '0x00002002')), 'a mouse').toBe(false);
  expect(listed('    4: pogo-utils touch\n      Classes: TOUCH | TOUCH_MT\n'), 'EventHub alone').toBe(false);
});

test('swipes as one command, moving along the line every 8ms or so of the time asked', () => {
  const steps = swipe([0, 0.5], [1, 0.5], 80).split('; ');
  const waits = steps.filter((step) => step.startsWith('read'));

  expect(steps[0]).toBe(write(report(true, [0, 0.5])));
  expect(steps[2], 'a move after the first wait').toBe(write(report(true, [0.1, 0.5])));
  expect(steps.at(-2), 'the last move at the end').toBe(write(report(true, [1, 0.5])));
  expect(steps.at(-1)).toBe(write(report(false, [1, 0.5])));
  expect(new Set(waits)).toEqual(new Set(['read -t 0.0080 -u4']));
  expect(waits).toHaveLength(10);
});

test('makes the device, then taps down and up at the point in one command', async () => {
  const { transport, commands } = phone(LISTED);
  const touch = await touchscreen(transport);

  expect(commands.slice(0, 3)).toEqual(['exec 3<>/dev/uhid 4<>/dev/uhid', write(create()), 'dumpsys input']);
  commands.length = 0;

  await touch.tap([0.1, 0.2]);
  expect(commands).toEqual([`${write(report(true, [0.1, 0.2]))}; ${write(report(false, [0.1, 0.2]))}`]);
});

test('fails where Android never takes it as a touchscreen', async () => {
  await expect(touchscreen(phone('').transport)).rejects.toThrow(/has not taken pogo-utils touch as a touchscreen/);
});
