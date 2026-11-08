import { said } from '../../errors.ts';
import { encodePng, type Image } from '../inventory/png.mts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The frames `run` keeps around each faint and shield prompt, named by when they were seen on the clock `started` is
 * read from, `0012.437s-shield.png`, so they sort into the log. Written one a turn of the event loop rather than as they
 * are handed over: an encode takes 10ms to 40ms and a second's frames come at once, which would hold up the answer to
 * the very prompt they show. `flush` writes whatever is still queued, and says how many were kept and why it stopped
 * keeping them only the first time it has each to say: it is called from both the ways out of a run, and an interrupted
 * one takes both.
 */
export function keepFrames(dir: string, started: number, now: () => number) {
  const queued: { frame: Image; at: number; event: string }[] = [];
  let written = 0;
  let failed: string | undefined;
  let toldFailed = false;

  mkdirSync(dir, { recursive: true });

  // A write that fails — the disk full, or `dir` gone — stops keeping frames and nothing else, as the video's does: it
  // runs from `setImmediate` and from the ways out, where a throw would be uncaught or skip putting the phone's setting
  // back.
  const save = (name: string, frame: Image) => {
    if (failed !== undefined) {
      return false;
    }

    try {
      writeFileSync(join(dir, name), encodePng(frame));

      return true;
    } catch (error) {
      failed = `${((now() - started) / 1000).toFixed(1)}s in: ${said(error)}`;

      return false;
    }
  };

  const write = ({ frame, at, event }: (typeof queued)[number]) => {
    if (save(`${((at - started) / 1000).toFixed(3).padStart(8, '0')}s-${event}.png`, frame)) {
      written++;
    }
  };

  const writeNext = () => {
    const next = queued.shift();

    if (next) {
      write(next);
      setImmediate(writeNext);
    }
  };

  return {
    keep: (frame: Image, at: number, event: string) => {
      if (queued.push({ frame, at, event }) === 1) {
        setImmediate(writeNext);
      }
    },

    /**
     * The frames a run was lost with, `00.png` on in the order they were seen, said to be kept only if every one was. A
     * write that fails is told by `flush` with the others rather than thrown over the error that stopped the run.
     */
    last: (lost: readonly Image[]) => {
      if (lost.every((frame, i) => save(`${String(i).padStart(2, '0')}.png`, frame))) {
        console.error(`kept the last ${lost.length} frames in ${dir}`);
      }
    },

    flush: () => {
      queued.splice(0).forEach(write);

      if (written > 0) {
        console.error(`kept ${written} frames around faints and shield prompts in ${dir}`);
        written = 0;
      }

      if (failed !== undefined && !toldFailed) {
        console.error(`stopped keeping frames in ${dir}: a write failed ${failed}`);
        toldFailed = true;
      }
    },
  };
}
