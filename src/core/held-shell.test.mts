/**
 * The held shell's failure paths against a fake `Pipe` and fake timers, which a real `adb shell` cannot be made to take
 * on demand: a command going unanswered, and the connection failing under a command being written.
 */

import { afterEach, beforeEach, expect, test, vi, type Mocked } from 'vitest';
import { holdShell, type Pipe } from './held-shell.mts';

const pipe = (): Mocked<Pipe> => ({
  write: vi.fn(),
  end: vi.fn(),
  kill: vi.fn(),
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('a command unanswered for 30s fails, kills the shell and fails every one after it', async () => {
  const fake = pipe();
  const held = holdShell(fake, 'adb shell');
  const stuck = expect(held.shell(['echo', 'one'])).rejects.toThrow(
    /^adb shell echo one: no answer after 30s; is the phone still connected\?$/,
  );

  await vi.advanceTimersByTimeAsync(29_999);
  expect(fake.kill, 'not before the timeout').not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(1);
  await stuck;
  expect(fake.kill).toHaveBeenCalledOnce();
  await expect(held.shell(['echo', 'two'])).rejects.toThrow(/no answer after 30s/);
});

test('the connection failing fails the command under way and every one after it', async () => {
  const held = holdShell(pipe(), 'adb shell');
  const under = expect(held.shell(['echo', 'one'])).rejects.toThrow(/^adb shell echo one: write EPIPE$/);

  await vi.advanceTimersByTimeAsync(0);
  held.fail(new Error('write EPIPE'));
  await under;
  await expect(held.shell(['echo', 'two'])).rejects.toThrow(/write EPIPE/);
});
