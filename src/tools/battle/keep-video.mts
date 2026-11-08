import { said } from '../../errors.ts';
import { type Recording } from './stream.mts';
import { Video } from './video.mts';
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * The whole of the screen a run watched, written to `file` a picture at a time once each is known whole and `HELD_MS`
 * have gone by since it came, or a cut is known: synchronously, at about 8 KB a picture, so that a run stopped by
 * Ctrl-C, which exits without waiting on a stream, still leaves all it saw. Opened here rather than at the first
 * picture, so a `file` that cannot be written throws before the run changes the phone.
 *
 * A write that fails — the disk full — stops the video and nothing else. It is heard from `screenrecord`'s stdout, from
 * `Video`'s timer for pictures held, and from the ways out, where a throw would be uncaught or skip putting the phone's
 * setting back, so it is kept to be told by `close` rather than thrown, and nothing more is written after it. `close`
 * is called from both the ways out of a run, and an interrupted one takes both: it tells what became of the file only
 * the first time.
 */
export function keepVideo(file: string, started: number, now: () => number) {
  mkdirSync(dirname(file), { recursive: true });

  let fd: number | undefined = openSync(file, 'w');
  let failed: string | undefined;
  let written = 0;

  const video = new Video(
    (bytes) => {
      if (fd === undefined || failed !== undefined) {
        return;
      }

      try {
        written += writeSync(fd, bytes);
      } catch (error) {
        failed = `${((now() - started) / 1000).toFixed(1)}s in: ${said(error)}`;
      }
    },
    started,
    now,
  );

  return {
    /** Keeps what `recording` sends, and hands it back for `feed` to decode. */
    watch: (recording: Recording) => video.watch(recording),

    close: () => {
      video.close();

      if (fd === undefined) {
        return;
      }

      // A close that fails is told apart from a write that did: what was written before it may be whole.
      let closeFailed: string | undefined;

      try {
        closeSync(fd);
      } catch (error) {
        closeFailed = said(error);
      }

      fd = undefined;

      // Nothing reaches the file before the first whole picture, which a run stopped early never sees.
      if (written === 0) {
        console.error(
          failed === undefined
            ? `no picture of the screen came, so ${file} is empty`
            : `nothing kept in ${file}: a write failed ${failed}`,
        );
      } else {
        console.error(
          failed === undefined
            ? `kept the screen in ${file}`
            : `kept the screen in ${file} only until a write failed ${failed}`,
        );
      }

      if (closeFailed !== undefined) {
        console.error(`closing ${file} failed: ${closeFailed}`);
      }
    },
  };
}
