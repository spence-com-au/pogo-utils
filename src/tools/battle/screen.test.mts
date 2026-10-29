/**
 * `Screen` over feeds a test hands frames to one at a time, with no recording or decoder behind them: the hand-over
 * and the failures that `stream.test.mts` drives through `ffmpeg`'s clips, here frame by frame and on a fake clock, so
 * without waiting on a clip's timing. A frame is told apart by its one pixel's red.
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { type Image } from '../inventory/png.mts';
import { Screen, type Feed } from './screen.mts';

/** How long each recording runs before the next starts, on the fake clock. */
const SEGMENT_MS = 1000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A feed whose frames come as the test sends them, until it ends, and which says whether it was stopped. */
function scripted(said?: string) {
  const queued: (Image | Error | null)[] = [];
  let wake = () => {};
  let stopped = false;

  const push = (item: Image | Error | null) => {
    queued.push(item);
    wake();
  };

  async function* frames(): AsyncGenerator<Image> {
    for (;;) {
      const next = queued.shift();

      if (next === undefined) {
        await new Promise<void>((resolve) => (wake = resolve));
      } else if (next === null) {
        return;
      } else if (next instanceof Error) {
        throw next;
      } else {
        yield next;
      }
    }
  }

  const feed: Feed = {
    frames: frames(),
    reason: () => said,
    stop: () => {
      stopped = true;
      push(null);
    },
  };

  return {
    feed,
    send: (red: number) => push({ width: 1, height: 1, data: Uint8Array.of(red, 0, 0, 255) }),
    end: (error?: Error) => push(error ?? null),
    stopped: () => stopped,
  };
}

/** A screen over `feeds` in the order they are started, and over feeds that never send once those run out. */
function watch(...feeds: ReturnType<typeof scripted>[]) {
  const started: ReturnType<typeof scripted>[] = [];
  const screen = new Screen(() => {
    const next = feeds[started.length] ?? scripted();
    started.push(next);
    return next.feed;
  }, SEGMENT_MS);

  return { screen, started };
}

/** The red of the frame `screen` answers, once what has been sent is taken. */
async function red(screen: Screen): Promise<number | undefined> {
  await vi.advanceTimersByTimeAsync(0);

  return screen.latest()?.image.data[0];
}

test('answers the first recording until the next sends its first frame, then stops the first', async () => {
  const first = scripted();
  const second = scripted();
  const { screen, started } = watch(first, second);

  try {
    expect(await red(screen)).toBeUndefined();
    first.send(1);
    expect(await red(screen)).toBe(1);

    await vi.advanceTimersByTimeAsync(SEGMENT_MS);
    expect(started).toHaveLength(2);
    first.send(2);
    expect(await red(screen), 'the next started and sent nothing yet').toBe(2);
    expect(first.stopped()).toBe(false);

    second.send(3);
    expect(await red(screen)).toBe(3);
    expect(first.stopped()).toBe(true);

    first.send(4);
    expect(await red(screen), 'never handed back to the first').toBe(3);
  } finally {
    screen.close();
  }
});

test('an older recording ending is no failure, its successor having started', async () => {
  const first = scripted('should not be heard');
  const { screen } = watch(first);

  try {
    first.send(1);
    await vi.advanceTimersByTimeAsync(SEGMENT_MS);
    first.end();

    expect(await red(screen)).toBe(1);
  } finally {
    screen.close();
  }
});

test('fails with what the recording said once the newest one ends', async () => {
  const only = scripted('Unable to get output buffers');
  const { screen } = watch(only);

  only.send(1);
  only.end(new Error('the decoder had nothing to decode'));
  await vi.advanceTimersByTimeAsync(0);

  expect(() => screen.latest()).toThrow(/^screen recording ended: Unable to get output buffers$/);
  expect((await screen.failed).message, 'told without being asked').toBe(
    'screen recording ended: Unable to get output buffers',
  );
});

test("fails with the decoder's reason where the recording said nothing", async () => {
  const only = scripted();
  const { screen } = watch(only);

  only.end(new Error('the decoder refused the stream'));
  await vi.advanceTimersByTimeAsync(0);

  expect(() => screen.latest()).toThrow(/^screen recording ended: the decoder refused the stream$/);
});

test('stops every recording still running when closed, the one yet to take over included', async () => {
  const first = scripted();
  const { screen, started } = watch(first);

  first.send(1);
  await vi.advanceTimersByTimeAsync(SEGMENT_MS);
  screen.close();

  expect(started.map((feed) => feed.stopped())).toEqual([true, true]);
});
