import { encodePng, type Image } from '../inventory/png.mts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The frames `run` keeps around each faint and shield prompt, named by when they were seen on the clock `started` is
 * read from, `0012.437s-shield.png`, so they sort into the log. Written one a turn of the event loop rather than as they
 * are handed over: an encode takes 10ms to 40ms and a second's frames come at once, which would hold up the answer to
 * the very prompt they show. `flush` writes whatever is still queued, and says how many were kept only the first time
 * it has any to say: it is called from both the ways out of a run, and an interrupted one takes both.
 */
export function keepFrames(dir: string, started: number) {
  const queued: { frame: Image; at: number; event: string }[] = [];
  let written = 0;

  mkdirSync(dir, { recursive: true });

  const write = ({ frame, at, event }: (typeof queued)[number]) => {
    const name = `${((at - started) / 1000).toFixed(3).padStart(8, '0')}s-${event}.png`;
    writeFileSync(join(dir, name), encodePng(frame));
    written++;
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

    flush: () => {
      queued.splice(0).forEach(write);

      if (written > 0) {
        console.error(`kept ${written} frames around faints and shield prompts in ${dir}`);
        written = 0;
      }
    },
  };
}
