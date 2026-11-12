/**
 * The look down a detail screen for its moves, which `pnpm inventory scan` takes for every Pokémon it writes: a scroll
 * to where the moves are, their reading off the screen it came to and the scroll back up, held to the reading it was
 * taken for so that another Pokémon's moves are never kept. Here rather than in the script so the suite can drive it
 * against recordings, the script handing in the phone, the overlay and the walk it reaches them by.
 */

import { type Device } from '../../core/adb.mts';
import { type Config } from './config.mts';
import { measuresIn, powerUpOn } from './detail.mts';
import { type Form, type GameData } from '../../core/game-master.mts';
import { movesCutOff, parseMoves, type Moves } from '../../core/moves.mts';
import { ocr } from '../../core/ocr.mts';
import { type Overlay } from './overlay.mts';
import { type Image } from '../../core/png.mts';
import { movesOf, reachMoves, type Reading, type Steps } from './scan.mts';
import { SCROLL_DRAG_MS, scrollFrames, scrollUp } from './scroll.mts';
import { offsetBetween, scrollStep, stitch } from './stitch.mts';
import { dialogOpen } from './storage.mts';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The note on a row whose swipe to the moves moved further than `offsetBetween` could measure, once however many. */
export const UNMEASURED_SWIPE = 'the swipe to the moves could not be measured; the scroll back is what it dragged';

/** What a look needs of the scan around it: the phone, the walk's read and swipe on, and where its captures go. */
export interface Looking extends Pick<Steps<Reading>, 'read' | 'next'> {
  device: Device;
  config: Pick<Config, 'scrollBand' | 'swipes' | 'waits'>;
  data: GameData;
  dismiss: () => Promise<void>;

  /** `--scroll`: a scroll capture of the whole screen, stitched, rather than a step at a time down to the moves. */
  scroll: boolean;

  /** Any screenshot, for the screen's size. */
  screen: Image;

  /** PGSharp's overlay on an image, `sweep` being leave to look for its box where it is not known. */
  overlayOf: (image: Image, sweep: boolean) => Promise<Overlay | null>;

  /** Writes a capture under `name` where `--keep-screens` asked for them, `carry` going into its `tEXt` chunks. */
  keep: (name: string, image: Image, carry?: Readonly<Record<string, string>>) => void;
}

/** What the look down a Pokémon's screen found, and what its row says of how it went. */
export interface Looked {
  moves: Moves;
  notes: string[];

  /** The stardust to power up off a screen looked at, where the detail screen's own did not read. */
  powerUp: number | null;
}

/**
 * The moves of the Pokémon `reading` read, looked for as `movesOf` and `reachMoves` decide and read for `form`, the
 * one the row has settled on so far. `name` is what its captures are kept under.
 */
export async function lookForMoves(
  { device, config, data, dismiss, scroll, screen, overlayOf, keep, read, next }: Looking,
  reading: Reading,
  name: string,
  form: Form | null,
): Promise<Looked> {
  const { detail, overlay } = reading;
  const notes: string[] = [];

  // From a reading rather than this one, since `movesOf` looks again from a fresh one where the screen scrolled down
  // was another Pokémon's.
  const look = async ({ image, latest }: Reading, steps: number) => {
    let scrolled: Image;

    // The screen the overlay is read off, which in a stitch is its last frame: the first is the detail screen.
    let shown: Image;
    let back: number;

    if (scroll) {
      // The same two halves `snap` takes: the screenshot already in hand as the first frame, rather than a second
      // photograph of a screen that has moved on, and the height it was drawn at recorded on the stitch.
      //
      // `latest` rather than `image`, since the frame handed over is the one `scrollFrames` does not wait for and the
      // reading may have come from an attempt before it.
      //
      // Under the plain name, the stitch being the capture and `-detail` above the frame the row was read from. `name`
      // here is the scan's own index, so a capture kept for the corpus is still renamed to the Pokémon it shows; what
      // the plain name buys is that the suffix is not part of what has to come off.
      const capture = await scrollFrames(device, config, latest);
      scrolled = stitch(capture.frames, capture.offsets, config.scrollBand);
      shown = capture.frames.at(-1) ?? latest;
      back = capture.offsets.reduce((a, b) => a + b, 0);
      keep(name, scrolled, { Viewport: `${latest.width}x${latest.height}` });

      // So the stitch and this row are a pair or say they are not. A fixture is promoted from the stitch while its
      // expectations are derived from the committed png, so nothing downstream would report the two having been read a
      // `config.waits.swipe` apart — and the readings that need a second look are the ones the corpus is collected for.
      if (latest !== image) {
        notes.push('the capture kept for this row is a later read of the screen than the row itself');
      }

      if (capture.lost) {
        notes.push(`the scroll lost its place after frame ${capture.frames.length}`);
      }
    } else {
      // One step of the `--scroll` branch's capture, at its speed, so that the shift lands inside what `offsetBetween`
      // looks for. Half the screen at `input swipe`'s 300ms moved a Pixel 4 XL's panel as far as 0.69 of the screen, to
      // its foot or flung past the finger, where the band reaches 0.41: 38 rows of 40 went unmeasured. The step still
      // brings the moves up from the panel's foot to about two-thirds of the way down, and `steps` of them is what
      // `reachMoves` asks for where one did not.
      //
      // A look after the first starts from a fresh screenshot rather than `latest`, since `scrollUp` stops short of the
      // top on purpose and what is measured has to be what it scrolls back.
      const [from, to] = scrollStep(config.scrollBand, latest.width, latest.height);
      scrolled = steps === 1 ? latest : await device.screenshot();
      back = 0;

      for (let step = 0; step < steps; step++) {
        const before = scrolled;

        await device.swipe(from, to, SCROLL_DRAG_MS);
        await sleep(config.waits.scroll);
        scrolled = await device.screenshot();

        // Measured against the screen before the swipe, on the same footing as the `--scroll` branch above and
        // `latest` for the same reason. What the drag asked for is no bound on what it got: the panel flings a little
        // past the finger, or has less than the step left to give, and the distance that matters is the one it
        // actually moved.
        const moved = offsetBetween(before, scrolled, config.scrollBand);
        back += moved ?? from[1] - to[1];

        // A fling past half the step again is more than `offsetBetween` looks for. Falling back to the drag can
        // overshoot the top where the panel had less than that to give, so it is recorded rather than hidden.
        if (moved === null && !notes.includes(UNMEASURED_SWIPE)) {
          notes.push(UNMEASURED_SWIPE);
        }
      }

      // The screen the moves were read from, so a second look replaces the first's.
      keep(`${name}-moves`, scrolled);
      shown = scrolled;
    }

    // Read while the phone scrolls back, since nothing that follows depends on the moves. Awaited with the swipes, so
    // that a read failing before the phone is back is a rejection here rather than an unhandled one.
    let dialog = false;
    let cutOff = false;
    let measures = '';
    const found = ocr(scrolled).then((lines) => {
      dialog = dialogOpen(lines, scrolled);
      cutOff = !scroll && movesCutOff(lines, scrolled);

      // Not off a stitch, whose first frame is the detail screen the reading came from and so vouches for it whatever
      // the frames below it show.
      measures = scroll ? '' : measuresIn(lines);

      return parseMoves(lines, data, form, scrolled);
    });

    // Only where the detail screen's overlay read, there being nothing to hold this one to otherwise, and without a
    // sweep: they are rationed, and the moves screen is no place to spend one.
    const seen = overlay ? overlayOf(shown, false) : Promise.resolve(null);

    // A panel above `POWER UP` can push it below the plain screen's foot, as Necrozma's fusion panel does, and then the
    // screen scrolled down for the moves is where its stardust is.
    const power = detail.powerUp === null ? powerUpOn(scrolled) : Promise.resolve(null);
    await Promise.all([found, seen, power, scrollUp(device, config, screen, back)]);

    // The swipe to the moves dropped as a tap and opened something. The drags back up did nothing over it — they run
    // down the margin, where no dialog has a button — so it is closed before the swipe to the next Pokémon, which would
    // do nothing either. Nor is it looked past, the screen read having been the dialog's.
    if (dialog) {
      await dismiss();
      notes.push('a dialog opened on the swipe to the moves and was closed');
    }

    return { moves: await found, cutOff: cutOff && !dialog, overlay: await seen, measures, powerUp: await power };
  };

  // The stardust off any look of one reach, since the step further down that a second look takes can scroll `POWER UP`
  // off the top. Per reach, so a look `movesOf` threw away for showing another Pokémon keeps none.
  const reach = async (from: Reading) => {
    let powerUp: number | null = null;
    const last = await reachMoves(async (steps) => {
      const found = await look(from, steps);
      powerUp = found.powerUp ?? powerUp;

      return found;
    });

    return { ...last, powerUp };
  };

  const took = await movesOf(reading, reach, { read, next });
  const moves = took.look?.moves ?? { fast: null, charged: [] };

  if (took.note) {
    notes.push(took.note);
  }

  if (moves.fast === null || moves.charged.length === 0) {
    notes.push('moves not fully read');
  }

  return { moves, powerUp: took.look?.powerUp ?? null, notes };
}
