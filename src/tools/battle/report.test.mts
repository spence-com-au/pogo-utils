import { Writable } from 'node:stream';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { describe, live, panel, plain, rule, summary, type Fight, type Status } from './report.mts';

const FIGHT: Fight = {
  own: { species: 'Charizard', cp: 2495, hp: 0.74, shields: 1, left: 2 },
  opponent: { species: 'Magmar', cp: 1826, hp: 0.5, shields: 2, left: 3 },
  moves: ['Blast Burn', 'Dragon Claw'],
  throwing: 'Dragon Claw',
  bait: true,
  shield: false,
};

const STATUS: Status = { battles: 1, count: 3, screen: 'battle', lostIn: 20_000, lostAfter: 20_000, fight: FIGHT };

/** A line of the table with nothing in either column, 80 wide. */
const EMPTY = `${' '.repeat(38)} │`;

test('draws ours at the left and the opponent at the right, how strong each is at its right and how many left', () => {
  expect(panel(FIGHT, 80).split('\n')).toEqual([
    'Charizard           74% │ ●○ │ CP 2495 │ Magmar              50% │ ●● │ CP 1826',
    '◓◓○               ███████████████░░░░░ │ ◓◓◓               ██████████░░░░░░░░░░',
    'Blast Burn, Dragon Claw                │',
    'baiting with Dragon Claw               │',
    'not shielding                          │',
  ]);
  expect(rule(80)).toBe(`${'─'.repeat(39)}┼${'─'.repeat(40)}`);
  expect(rule(80, '┬')).toBe(`${'─'.repeat(39)}┬${'─'.repeat(40)}`);
});

test('gives the name what a narrower terminal leaves, and the bar what it can', () => {
  expect(panel(FIGHT, 50).split('\n').slice(0, 2)).toEqual([
    'Cha  74% │ ●○ │ CP 2495 │ Mag  50% │ ●● │ CP 1826',
    '◓◓○ ██████████████░░░░░ │ ◓◓◓ ██████████░░░░░░░░░',
  ]);
  expect(panel(FIGHT, 20).split('\n').slice(0, 2)).toEqual([' CP 2495 │  CP 1826', '◓◓○ ███░ │ ◓◓◓ ██░░']);
});

test('marks what has not been read, each thing still in its place', () => {
  const unread = { species: null, cp: null, hp: null, shields: 2, left: null };

  expect(panel({ ...FIGHT, own: unread, moves: [], throwing: undefined }, 80).split('\n')).toEqual([
    '?                    ?% │ ●● │ CP    ? │ Magmar              50% │ ●● │ CP 1826',
    '???               ???????????????????? │ ◓◓◓               ██████████░░░░░░░░░░',
    '?                                      │',
    'baiting with the first ready           │',
    'not shielding                          │',
  ]);
});

test('tells the opponent’s energy where it is counted, under its bar and at the end of the line', () => {
  const counted = { ...FIGHT, energy: { energy: 40, fast: 'Karate Chop' } };

  expect(panel(counted, 80).split('\n')[2]).toBe('Blast Burn, Dragon Claw                │ energy 40 by Karate Chop');
  expect(describe(counted)).toMatch(/, 1 of our shields left; their energy 40 by Karate Chop$/);
  expect(describe(FIGHT)).toMatch(/, 1 of our shields left$/);
});

test('keeps every line of the panel before a battle', () => {
  expect(panel(undefined, 80).split('\n')).toEqual([`${'no battle yet'.padEnd(38)} │`, EMPTY, EMPTY, EMPTY, EMPTY]);
});

test('says how the run stands, counting down to its stopping once nothing has been recognised for a second', () => {
  expect(summary(STATUS)).toBe('1 of 3 finished; battle');
  expect(summary({ ...STATUS, count: Infinity, screen: 'party' })).toBe('1 finished; party');
  expect(summary(undefined)).toBe('0 finished; starting');
  expect(summary({ ...STATUS, screen: 'other', lostIn: 19_500 })).toBe('1 of 3 finished; other');
  expect(summary({ ...STATUS, screen: 'other', lostIn: 12_300 })).toBe('1 of 3 finished; other, stopping in 13s');
});

test('writes the battle as a line each time it changes, and each event, after how long the run has gone on', () => {
  const lines: string[] = [];
  let now = 0;
  const report = plain(
    (line) => lines.push(line),
    () => now,
  );

  report.status(STATUS);
  now = 12_437;
  report.status({ ...STATUS, screen: 'charged' });
  report.event('threw Dragon Claw', 'own');
  now = 14_960;
  report.event('took shield', 'own', 'Fire Blast would take ~48%, with 9% left');
  report.status({ ...STATUS, fight: { ...FIGHT, shield: true } });
  now = 1_234_567;
  report.status({ ...STATUS, fight: undefined });
  report.event('battle 1 finished');

  expect(lines).toEqual([
    '   0.0s Charizard against Magmar (2 shields): Blast Burn, Dragon Claw, baiting with Dragon Claw, not shielding; CP 2495 at 74% against CP 1826 at 50%, 1 of our shields left',
    '  12.4s threw Dragon Claw',
    '  15.0s took shield: Fire Blast would take ~48%, with 9% left',
    '  15.0s Charizard against Magmar (2 shields): Blast Burn, Dragon Claw, baiting with Dragon Claw, shielding; CP 2495 at 74% against CP 1826 at 50%, 1 of our shields left',
    '1234.6s battle 1 finished',
  ]);
});

/** A terminal `columns` wide and `rows` tall that keeps everything written to it. */
function terminal(columns = 80, rows = 24) {
  let written = '';
  const stream = Object.assign(
    new Writable({
      write(chunk: Buffer, _encoding, done) {
        written += chunk.toString();
        done();
      },
    }),
    { isTTY: true, columns, rows },
  ) as unknown as NodeJS.WriteStream;

  // The screen as the last redraw left it, a line to each row.
  const shown = () => {
    const last = written.split('\x1b[?2026h\x1b[H').at(-1) ?? '';

    return (last.split('\x1b[J')[0] ?? '').replaceAll('\x1b[K', '').split('\r\n');
  };

  return { stream, written: () => written, shown };
}

const faded = (line: string) => `\x1b[2m${line}\x1b[22m`;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('keeps the terminal in fixed parts: the run, the two sides and what each did, then the run’s own events', () => {
  const { stream, written, shown } = terminal(80, 24);
  const report = live(stream);

  report.status(STATUS);
  report.event('party: Charizard, Gyarados, Mamoswine');
  report.event('battle 2 started');
  report.event('threw Dragon Claw', 'own');
  report.event('Magmar threw a charged move', 'opponent');
  report.event('tap shield', 'own');
  vi.advanceTimersByTime(100);

  expect(written().startsWith('\x1b[?1049h')).toBe(true);
  expect(shown()).toEqual([
    faded('1 of 3 finished; battle'),
    '',
    rule(80, '┬'),
    ...panel(FIGHT, 80).split('\n'),
    rule(80),
    'threw Dragon Claw                      │',
    '                                       │ Magmar threw a charged move',
    'tap shield                             │',
    EMPTY,
    EMPTY,
    rule(80, '┴'),
    '',
    faded('party: Charizard, Gyarados, Mamoswine'),
    faded('battle 2 started'),
    '',
    '',
    '',
    '',
    '',
    '',
  ]);
});

test('keeps each part where it is from the first draw, whether or not a status or event has come', () => {
  const { stream, shown } = terminal(80, 24);
  const report = live(stream);

  report.event('map: tap');

  const before = shown();

  vi.advanceTimersByTime(100);
  report.status(STATUS);
  vi.advanceTimersByTime(100);
  report.event('threw Dragon Claw', 'own');

  expect(before).toHaveLength(24);
  expect(shown()).toHaveLength(24);

  for (const screen of [before, shown()]) {
    expect(screen.indexOf(rule(80))).toBe(8);
    expect(screen.indexOf(rule(80, '┴'))).toBe(14);
    expect(screen[16]).toBe(faded('map: tap'));
  }
});

test('gives the run’s events at the foot their last eight, and what the sides did the rest of the height', () => {
  const { stream, shown } = terminal(80, 30);
  const report = live(stream);

  report.status(STATUS);
  Array.from({ length: 20 }, (_, i) => report.event(`tap ${i}`));
  Array.from({ length: 20 }, (_, i) => report.event(`tap shield ${i}`, 'own'));
  vi.advanceTimersByTime(100);

  expect(shown().slice(9, 20)).toEqual(Array.from({ length: 11 }, (_, i) => `tap shield ${i + 9}`.padEnd(38) + ' │'));
  expect(shown().slice(22)).toEqual(Array.from({ length: 8 }, (_, i) => faded(`tap ${i + 12}`)));
});

test('keeps each line within the width of the terminal, wrapping what a side did within its column', () => {
  const { stream, shown } = terminal(20, 24);
  const report = live(stream);

  report.status(STATUS);
  report.event('party: Charizard, Gyarados, Mamoswine');
  report.event('Magmar threw a charged move', 'opponent');
  vi.advanceTimersByTime(100);

  const unfaded = (line: string) => line.replace('\x1b[2m', '').replace('\x1b[22m', '');

  expect(shown().every((line) => [...unfaded(line)].length <= 20)).toBe(true);
  expect(shown()[3]).toBe(' CP 2495 │  CP 1826');
  expect(shown().slice(9, 13)).toEqual([
    '         │ Magmar',
    '         │   threw a',
    '         │   charged',
    '         │   move',
  ]);
  expect(shown()[16]).toBe(faded('party: Charizard, Gy'));
});

test('draws why a side did something faint after it, carrying on below where it is too long', () => {
  const { stream, shown } = terminal(80, 24);
  const report = live(stream);

  report.status(STATUS);
  report.event('took shield', 'own', 'Fire Blast would take ~48%, with 9% left');
  report.event('Magmar shielded our Blast Burn', 'opponent', 'a guess');
  report.event('threw Dragon Claw', 'own');
  vi.advanceTimersByTime(100);

  expect(shown().slice(9, 13)).toEqual([
    `took shield:${faded(' Fire Blast would take')}     │`,
    `  ${faded('~48%, with 9% left')}                   │`,
    `${' '.repeat(38)} │ Magmar shielded our Blast Burn:${faded(' a guess')}`,
    'threw Dragon Claw                      │',
  ]);
});

test('redraws at most every 100ms, drawing the last status it was sent', () => {
  const { stream, written } = terminal();
  const report = live(stream);

  report.status(STATUS);
  report.status({ ...STATUS, screen: 'charged' });
  report.status({ ...STATUS, screen: 'switch' });

  expect(written()).toContain('1 of 3 finished; battle');
  expect(written()).not.toMatch(/charged|switch/);

  vi.advanceTimersByTime(100);

  expect(written()).not.toContain('charged');
  expect(written()).toContain('switch');
});

test('gives the terminal back when done, writing the last screen into it a line short, for the prompt', () => {
  const { stream, written } = terminal(80, 24);
  const report = live(stream);

  report.status(STATUS);
  report.event('tap shield', 'own');
  report.status({ ...STATUS, battles: 2 });
  report.done();

  const left = written().split('\x1b[?25h\x1b[?1049l');

  expect(left).toHaveLength(2);

  const lines = left[1]?.split('\n') ?? [];

  expect(lines).toHaveLength(24);
  expect(lines.slice(0, 10)).toEqual([
    faded('2 of 3 finished; battle'),
    '',
    rule(80, '┬'),
    ...panel(FIGHT, 80).split('\n'),
    rule(80),
    'tap shield                             │',
  ]);

  report.status(STATUS);
  report.done();
  vi.advanceTimersByTime(100);

  expect(written().split('\x1b[?25h\x1b[?1049l')).toHaveLength(2);
});

/** Pictures in a terminal with cells 10×21, each drawn as `[picture N rows]`, and a phone frame at `streamSize`. */
function phone() {
  const drawn: number[] = [];
  const image = { width: 360, height: 802, data: new Uint8Array() };
  const pictures = {
    cell: { width: 10, height: 21 },
    picture: (_image: unknown, rows: number) => {
      drawn.push(rows);

      return `[picture ${rows} rows]`;
    },
    close: vi.fn(),
  };

  return { pictures, image, drawn };
}

/** What a redraw put in front of each line, and the lines without it. */
const indented = (lines: string[], by: number) => lines.map((line) => line.replace(`\x1b[${by}G`, ''));

test('draws the phone down the left edge, the table beside it at the width it leaves, each frame once', () => {
  const { stream, written, shown } = terminal(130, 24);
  const { pictures, image, drawn } = phone();
  let frame: typeof image | undefined = image;
  const report = live(stream, { pictures, frame: () => frame });

  report.status(STATUS);

  // 24 rows of 21 pixels is 504 tall, so 226 across: 23 columns, and one between it and the table.
  expect(shown()[0]?.startsWith('[picture 24 rows]\x1b[25G')).toBe(true);
  expect(shown().every((line) => line.includes('\x1b[25G'))).toBe(true);
  expect(indented(shown(), 25).slice(2, 4)).toEqual([rule(106, '┬'), panel(FIGHT, 106).split('\n')[0]]);

  vi.advanceTimersByTime(100);
  report.status({ ...STATUS, screen: 'charged' });

  expect(drawn).toEqual([24]);
  expect(shown()[0]?.startsWith('\x1b[25G')).toBe(true);

  frame = { ...image };
  report.status(STATUS);
  vi.advanceTimersByTime(100);

  expect(drawn).toEqual([24, 24]);

  report.done();

  expect(written()).toContain('\x1b_Ga=d,d=I,i=1,q=2;\x1b\\\x1b[?25h\x1b[?1049l');
  expect(written().split('\x1b[?1049l')[1]?.split('\n')[2]).toBe(rule(130, '┬'));
  expect(pictures.close).toHaveBeenCalled();
});

test('draws the latest frame alone ten times a second, with no status to redraw the rest, and the rest once one first comes', () => {
  const { stream, written } = terminal(130, 24);
  const { pictures, image, drawn } = phone();
  let frame: typeof image | undefined;
  const report = live(stream, { pictures, frame: () => frame });

  report.status(STATUS);
  frame = image;
  vi.advanceTimersByTime(100);

  expect(drawn).toEqual([24]);
  expect(written().split('\x1b[?2026h').at(-1)).toContain('\x1b[25G');

  const before = written().length;

  // A second of `screenrecord`'s 30 frames, in whole milliseconds so that the last lands on a tenth of a second.
  for (let i = 0; i < 30; i++) {
    frame = { ...image };
    vi.advanceTimersByTime(i % 3 === 2 ? 34 : 33);
  }

  expect(drawn).toHaveLength(11);
  expect(written().slice(before).split('\x1b[?2026h').slice(1)).toEqual(
    Array<string>(10).fill('\x1b[H[picture 24 rows]\x1b[?2026l'),
  );

  // The rest redrawn sooner than that after the last picture keeps it, for all that a frame has come since.
  frame = { ...image };
  vi.advanceTimersByTime(50);
  report.status(STATUS);

  expect(drawn).toHaveLength(11);

  vi.advanceTimersByTime(50);

  expect(drawn).toHaveLength(12);

  // Twice as wide is 46 columns, which moves the table over, so is drawn with the rest.
  frame = { ...image, width: 720 };
  vi.advanceTimersByTime(100);

  expect(drawn).toHaveLength(13);
  expect(written().split('\x1b[?2026h').at(-1)).toContain('\x1b[48G');

  report.done();
  vi.advanceTimersByTime(1000);

  expect(drawn).toHaveLength(13);
});

test('leaves the phone out where the table would be narrower than 80 beside it, or there is no frame yet', () => {
  const { stream, shown } = terminal(103, 24);
  const { pictures, drawn } = phone();
  const report = live(stream, { pictures, frame: () => undefined });

  report.status(STATUS);

  expect(shown()[2]).toBe(rule(103, '┬'));

  const narrow = terminal(103, 24);
  const fits = phone();

  live(narrow.stream, { pictures: fits.pictures, frame: () => fits.image }).status(STATUS);

  expect(drawn).toEqual([]);
  expect(fits.drawn).toEqual([]);
  expect(narrow.shown()[2]).toBe(rule(103, '┬'));
});
