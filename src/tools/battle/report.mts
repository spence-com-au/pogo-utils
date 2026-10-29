import { type Image } from '../inventory/png.mts';
import { columnsFor, ERASE, type Pictures } from './kitty.mts';
import { energyOf, PARTY, summary, type Fight, type Reporter, type Side, type Status } from './reporter.mts';

/**
 * What `run` tells of itself, as a terminal shows it: `plain` writes it as lines, for a log or a pipe; `live` takes over
 * a terminal, laid out in fixed parts.
 */

/** The status's battle as one line, the one `--verbose` has always written. */
export function describe({ own, opponent, moves, throwing, bait, shield, energy }: Fight): string {
  const side = ({ cp, hp }: Side) => `CP ${cp ?? '?'} at ${hp === null ? '?' : Math.round(hp * 100)}%`;
  const counted = energy ? `; their energy ${energyOf(energy)}` : '';

  return `${own.species ?? '?'} against ${opponent.species ?? '?'} (${opponent.shields} shields): ${moves.join(', ') || '?'}, ${bait ? 'baiting with' : 'throwing'} ${throwing ?? 'the first ready'}, ${shield ? '' : 'not '}shielding; ${side(own)} against ${side(opponent)}, ${own.shields} of our shields left${counted}`;
}

/**
 * Each event as a line, and the battle's line again each time it changes, each after how long the run has gone on,
 * `elapsed` in milliseconds, as `  12.4s`: how long a charged move was held, or a prompt went unanswered, is the gap
 * between two lines.
 */
export function plain(write: (line: string) => void, elapsed: () => number): Reporter {
  let said = '';
  const stamped = (line: string) => write(`${(elapsed() / 1000).toFixed(1).padStart(6)}s ${line}`);

  return {
    event: (line, _side, why) => stamped(why ? `${line}: ${why}` : line),
    status({ fight }) {
      const saying = fight && describe(fight);

      if (saying && saying !== said) {
        stamped(saying);
        said = saying;
      }
    },
  };
}

/** How long the HP bar is drawn at most, in characters: shorter where its column is narrower. */
const BAR = 20;

/** What goes between the two sides' columns. */
const DIVIDER = ' │ ';

/** `text` cut to `width` characters, and padded out to it where `pad`. */
function fit(text: string, width: number, pad = true): string {
  const kept = [...text].slice(0, Math.max(0, width));

  return kept.join('') + (pad ? ' '.repeat(Math.max(0, width - kept.length)) : '');
}

/** How wide each side's column is in a line `width` wide: ours at the left, the opponent's at the right. */
const columnOf = (width: number) => Math.floor((width - DIVIDER.length) / 2);

/** Ours and the opponent's laid side by side in a line `width` wide, each cut to its column. */
function beside(own: string, opponent: string, width: number): string {
  const column = columnOf(width);

  return `${fit(own, column)}${DIVIDER}${fit(opponent, width - column - DIVIDER.length, false)}`.trimEnd();
}

/** A rule across a line `width` wide, met where the columns divide by `join`: `┬` above them, `┼` between, `┴` below. */
export function rule(width: number, join = '┼'): string {
  const column = columnOf(width);

  return `${'─'.repeat(column)}─${join}─${'─'.repeat(Math.max(0, width - column - DIVIDER.length))}`;
}

/** How many lines the panel is, whatever is known. */
const PANEL_ROWS = 5;

/**
 * The battle as the panel's lines, `width` wide, ours at the left and theirs at the right. Always `PANEL_ROWS` of them,
 * each thing on its own whatever is known, so nothing on the screen moves as more of it is: the lines of a battle not
 * yet begun are left empty.
 */
export function panel(fight: Fight | undefined, width: number): string {
  if (!fight) {
    return [beside('no battle yet', '', width), ...Array<string>(PANEL_ROWS - 1).fill(beside('', '', width))].join(
      '\n',
    );
  }

  // How strong each side is sits at its column's right, the same width whatever is known, `100% │ ●● │ CP 2495`, and
  // the name gets what is left of the line; the HP bar has the line under them, set at the right too, and the Pokémon
  // left at its left, as the game draws its Poké Balls.
  const column = columnOf(width);
  const long = Math.max(0, Math.min(BAR, column - PARTY - 1));

  const name = ({ species, cp, hp, shields }: Side) => {
    const percent = hp === null ? '  ?' : `${Math.round(hp * 100)}`.padStart(3);
    const strength = `${percent}% │ ${'●'.repeat(shields)}${'○'.repeat(2 - shields)} │ CP ${`${cp ?? '?'}`.padStart(4)}`;

    return (fit(species ?? '?', column - strength.length - 1) + ' ' + strength).slice(-column);
  };

  const health = ({ hp, left }: Side) => {
    const filled = hp === null ? 0 : Math.round(hp * long);
    const bar = hp === null ? '?'.repeat(long) : '█'.repeat(filled) + '░'.repeat(long - filled);
    const balls = left === null ? '?'.repeat(PARTY) : '◓'.repeat(left) + '○'.repeat(PARTY - left);

    return fit(balls + bar.padStart(column - PARTY), column);
  };

  return [
    beside(name(fight.own), name(fight.opponent), width),
    beside(health(fight.own), health(fight.opponent), width),
    beside(fight.moves.join(', ') || '?', fight.energy ? `energy ${energyOf(fight.energy)}` : '', width),
    beside(`${fight.bait ? 'baiting with' : 'throwing'} ${fight.throwing ?? 'the first ready'}`, '', width),
    beside(fight.shield ? 'shielding' : 'not shielding', '', width),
  ].join('\n');
}

/** How often the screen may be redrawn, in milliseconds: a status comes with every frame, 30 a second. */
const DRAW_MS = 100;

/**
 * How often the phone is looked at for a new frame, in milliseconds, which is drawn alone if there is one; a redraw of
 * the rest in between keeps the frame drawn last. Drawn only with the rest, it stood still through every wait of the
 * run's that sends no status, a menu's 1.5s among them.
 *
 * Ten a second rather than every frame `screenrecord` sends. Replaying a 208s GO Battle League recording through `run`
 * in Ghostty, all 30 a second left the terminal up to 12 frames behind and too busy to read the rest of what was
 * written, and stderr, which Node writes to a terminal synchronously, held the run up for 5.0s in all, 181ms at once:
 * the slowest 1% of frames waited 160ms to be read, against 89ms with no picture. Ten a second it was never more than
 * one frame behind, no write was held up more than 1.6ms, and the slowest 1% waited 86ms to 97ms, against 84ms.
 */
const PICTURE_MS = 100;

/** Events kept of each kind: more than any terminal is tall. */
const KEPT_EVENTS = 1_000;

/** How many lines the run's own events are given at the foot of the screen: a way round the menus is seven. */
const RUN_ROWS = 8;

/** Entering the alternate screen with the cursor hidden, and leaving it with the cursor shown again. */
const ENTER = '\x1b[?1049h\x1b[?25l';
const LEAVE = '\x1b[?25h\x1b[?1049l';

/** A redraw from the top left, framed as one update so the terminal shows it whole rather than half drawn. */
const SYNC = '\x1b[?2026h';
const BEGIN = `${SYNC}\x1b[H`;
const UNSYNC = '\x1b[?2026l';
const END = `\x1b[J${UNSYNC}`;
const CLEAR_LINE = '\x1b[K';

/** How wide the table must still be with the phone beside it, or the phone is left out; and the gap between them. */
const TABLE_MIN = 80;
const GAP = 1;

/** Drawn faint, for what is told outside the two sides' table. */
const faded = (line: string) => `\x1b[2m${line}\x1b[22m`;

/** How far a line an event wraps onto is set in, so it reads as the one before it carried on. */
const HANGING = '  ';

/**
 * `line`, and after it `why` drawn faint, as rows `width` wide, padded out to it where `pad`: wrapped at spaces, so a
 * reason too long for its column carries on below rather than losing its end, and a word longer than the row is cut.
 * Laid out before anything is drawn faint, so each row's width counts only what shows.
 */
function told(line: string, why: string | undefined, width: number, pad = true): string[] {
  const plain = [...line].length;
  const words: { text: string[]; faint: boolean }[] = [];
  let at = 0;

  for (const word of (why ? `${line}: ${why}` : line).split(' ')) {
    words.push({ text: [...word], faint: at >= plain });
    at += [...word].length + 1;
  }

  // Each row as its words, the first of a row after the first set in by `HANGING`.
  const rows: { text: string[]; faint: boolean }[][] = [[]];

  for (const word of words) {
    const row = rows.at(-1) ?? [];
    const used = row.reduce((sum, { text }) => sum + text.length + 1, rows.length > 1 ? HANGING.length : 0);

    if (row.length > 0 && used + word.text.length > width) {
      rows.push([word]);
    } else {
      row.push(word);
    }
  }

  return rows.map((row, i) => {
    const start = i === 0 ? '' : HANGING;
    const room = Math.max(0, width - start.length);

    // The row's characters, each faint or not, cut to the room, then drawn a run of either at a time.
    const shown = row
      .flatMap(({ text, faint }, j) => [...(j === 0 ? [] : [' ']), ...text].map((char) => ({ char, faint })))
      .slice(0, room);
    let drawn = start;

    for (let from = 0; from < shown.length;) {
      const faint = shown[from]?.faint;
      let to = from;

      while (to < shown.length && shown[to]?.faint === faint) {
        to++;
      }

      const run = shown
        .slice(from, to)
        .map(({ char }) => char)
        .join('');

      drawn += faint ? faded(run) : run;
      from = to;
    }

    return drawn + (pad ? ' '.repeat(room - shown.length) : '');
  });
}

/** The last `rows` of `lines`, and `blank` lines after them to make up `rows` while there are fewer. */
function last(lines: readonly string[], rows: number, blank: string): string[] {
  const kept = lines.slice(-rows);

  return [...kept, ...Array<string>(Math.max(0, rows - kept.length)).fill(blank)];
}

/**
 * `stream`, a terminal, taken over whole and kept in fixed parts, so nothing moves as the run goes on: the phone's
 * `frame` down the left edge, where the terminal draws `pictures` and is wide enough for it, then how the run
 * stands at the top, then a table of the two sides, ours at the left and theirs at the right, of the panel above and
 * what each side did below it, then the run's own events at the foot. What is outside the table is drawn faint, as
 * less to watch. Redrawn as anything changes, or the terminal is resized, but no more than every `DRAW_MS`; every line
 * is cut to the terminal's width, as one wrapped would push the rest down. `done` gives the terminal back and writes
 * the last screen into it, so a run that stopped can still be read once it has.
 */
export function live(
  stream: NodeJS.WriteStream,
  phone?: { pictures: Pictures; frame: () => Image | undefined },
): Reporter & { done(): void } {
  const sides: { line: string; side: 'own' | 'opponent'; why: string | undefined }[] = [];
  const runs: string[] = [];
  let latest: Status | undefined;
  let entered = false;
  let finished = false;
  let drawnAt = -Infinity;
  let pending: NodeJS.Timeout | undefined;

  // The frame last drawn, how tall and the columns it took, which is drawn again only once any has changed.
  let pictured: { image: Image; rows: number; beside: number } | undefined;

  // The frame to draw down the left edge and the columns it takes with the gap, or none where there is no frame yet or
  // the table would be narrower than `TABLE_MIN` beside it. The `latest` frame only for a look, and otherwise the one
  // last drawn while there is one, so that redrawing the rest never draws the phone more often than `PICTURE_MS`.
  const fit = (columns: number, rows: number, latest = false) => {
    const image = latest || !pictured ? phone?.frame() : pictured.image;
    const beside = phone && image ? columnsFor(image, rows, phone.pictures.cell) + GAP : 0;

    return image && beside > 0 && columns - beside >= TABLE_MIN ? { image, beside } : undefined;
  };

  // The screen's `rows` lines, `width` wide, each cut to the width and faint where it is outside the table.
  const screen = (rows: number, width: number) => {
    const cut = (line: string) => [...line].slice(0, width).join('');

    // What the sides did fills what the summary and a blank line, the table's rules and panel, and a blank line and
    // the run's events leave. Each is already its column's width, so is not cut again.
    const logged = Math.max(1, rows - (2 + 3 + PANEL_ROWS + 1 + RUN_ROWS));
    const column = columnOf(width);
    const done = sides.flatMap(({ line, side, why }) =>
      side === 'own'
        ? told(line, why, column).map((row) => `${row}${DIVIDER.trimEnd()}`)
        : told(line, why, width - column - DIVIDER.length, false).map((row) => `${' '.repeat(column)}${DIVIDER}${row}`),
    );

    return [
      faded(cut(summary(latest))),
      '',
      rule(width, '┬'),
      ...panel(latest?.fight, width).split('\n').map(cut),
      rule(width),
      ...last(done, logged, beside('', '', width)),
      rule(width, '┴'),
      '',
      ...last(runs, RUN_ROWS, '').map((line) => (line ? faded(cut(line)) : line)),
    ].slice(0, rows);
  };

  const draw = (latest = false) => {
    clearTimeout(pending);
    pending = undefined;
    drawnAt = Date.now();

    if (finished) {
      return;
    }

    // Taken over only once there is something to draw, so whatever is written before the run begins stays readable.
    if (!entered) {
      stream.write(ENTER);
      entered = true;
    }

    const { columns, rows } = stream;
    const { image: shown, beside } = fit(columns, rows, latest) ?? { beside: 0 };
    let picture = '';

    if (phone && shown && (shown !== pictured?.image || rows !== pictured.rows)) {
      picture = phone.pictures.picture(shown, rows);
      pictured = { image: shown, rows, beside };
    } else if (!shown && pictured) {
      picture = ERASE;
      pictured = undefined;
    }

    // Each line set in past the phone by moving the cursor rather than by spaces, which would draw over it.
    const indent = shown ? `\x1b[${beside + 1}G` : '';

    stream.write(
      BEGIN +
        picture +
        screen(rows, shown ? columns - beside : columns)
          .map((line) => indent + line + CLEAR_LINE)
          .join('\r\n') +
        END,
    );
  };

  const request = () => {
    const wait = drawnAt + DRAW_MS - Date.now();

    if (wait <= 0) {
      draw();
    } else {
      pending ??= setTimeout(draw, wait).unref();
    }
  };

  // A new frame drawn alone, where it takes the place of the last at the same size; anything else moves the table, so
  // redraws the lot.
  const look = () => {
    if (!phone || !entered || finished) {
      return;
    }

    const fitted = fit(stream.columns, stream.rows, true);

    if (fitted && pictured && stream.rows === pictured.rows && fitted.beside === pictured.beside) {
      if (fitted.image !== pictured.image) {
        stream.write(`${SYNC}\x1b[H${phone.pictures.picture(fitted.image, stream.rows)}${UNSYNC}`);
        pictured = { image: fitted.image, rows: stream.rows, beside: fitted.beside };
      }
    } else if (fitted || pictured) {
      draw(true);
    }
  };

  const looking = phone && setInterval(look, PICTURE_MS).unref();

  stream.on('resize', draw);

  return {
    event(line, side, why) {
      if (side) {
        sides.push({ line, side, why });
        sides.splice(0, sides.length - KEPT_EVENTS);
      } else {
        // All of the run's own events are faint already.
        runs.push(why ? `${line}: ${why}` : line);
        runs.splice(0, runs.length - KEPT_EVENTS);
      }

      request();
    },
    status(status) {
      latest = status;
      request();
    },
    done() {
      clearTimeout(pending);
      clearInterval(looking);
      stream.off('resize', draw);

      if (entered && !finished) {
        stream.write(`${pictured ? ERASE : ''}${LEAVE}${screen(stream.rows - 1, stream.columns).join('\n')}\n`);
      }

      phone?.pictures.close();

      finished = true;
    },
  };
}
