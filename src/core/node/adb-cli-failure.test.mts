/**
 * The `adb` transports' failure paths against a stubbed `node:child_process`, which a real `adb` cannot be made to take
 * on demand: `execFile` killed for taking over 30s, and the held `adb shell`'s stdin failing under a command.
 */

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { expect, test, vi } from 'vitest';
import { adbCli, adbHeld } from './adb-cli.mts';

const child = vi.hoisted(() => ({ execFile: vi.fn(), spawn: vi.fn() }));

vi.mock('node:child_process', () => child);

test('a call killed for taking over 30s fails, naming the call and the phone', async () => {
  child.execFile.mockImplementation((_file, _args, _options, done) =>
    done(Object.assign(new Error('killed'), { killed: true }), Buffer.alloc(0), Buffer.from('ignored')),
  );

  await expect(adbCli().shell(['echo', 'one'])).rejects.toThrow(
    /^adb shell echo one: no answer after 30s; is the phone still connected\?$/,
  );
  expect(child.execFile).toHaveBeenCalledWith(
    'adb',
    ['shell', 'echo', 'one'],
    expect.objectContaining({ timeout: 30_000 }),
    expect.any(Function),
  );
});

test('a call that fails otherwise fails with what adb wrote', async () => {
  child.execFile.mockImplementation((_file, _args, _options, done) =>
    done(new Error('exit 1'), Buffer.alloc(0), Buffer.from('error: no devices\n')),
  );

  await expect(adbCli().state()).rejects.toThrow(/^adb get-state: error: no devices$/);
});

/** As unplugging the phone breaks the pipe to `adb shell` before its process has ended. */
test('the shell failing to take a write fails the command under way and every one after it', async () => {
  const stdin = Object.assign(new PassThrough(), { write: vi.fn(() => true), end: vi.fn() });
  const process = Object.assign(new EventEmitter(), {
    stdin,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });

  child.spawn.mockReturnValue(process);

  const held = adbHeld();
  const under = expect(held.shell(['echo', 'one'])).rejects.toThrow(
    /^adb shell echo one: adb shell: write EPIPE; is the phone still connected\?$/,
  );

  await Promise.resolve();
  stdin.emit('error', new Error('write EPIPE'));
  await under;
  await expect(held.shell(['echo', 'two'])).rejects.toThrow(/write EPIPE/);
});
