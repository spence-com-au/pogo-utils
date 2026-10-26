/**
 * The command line itself, driven as a subprocess. `scripts/inventory.mts` is the one part of the scanner no test
 * reaches — nothing imports it, so the whole suite passes a script that cannot start, a `parseArgs` that rejects a flag
 * the usage advertises, and a usage block the script can no longer find in its own source.
 *
 * Driven rather than imported because importing it runs it: `parseArgs` and the command dispatch are both at the top
 * level, so a test that loaded the module would parse Vitest's own argv and then try to drive a phone. A subprocess is
 * also the interface a person uses.
 *
 * Nothing here reaches the network or a phone. `reads` builds the cache the readers would otherwise download, and
 * `parse` needs neither `adb` nor a device. Tesseract it does need, as the capture readers beside it do.
 */

import { GAME_MASTER_CACHE, ICON_CACHE } from './download.mts';
import { encodePng } from './png.mts';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { typeable } from './adb.mts';
import { CLEAR_KEYS } from './storage.mts';

const run = promisify(execFile);

const SCRIPT = fileURLToPath(new URL('../../../scripts/inventory.mts', import.meta.url));
const SOURCE = readFileSync(SCRIPT, 'utf8');
const CAPTURE = fileURLToPath(new URL('fixtures/overworld.png', import.meta.url));

/** One printed line of the OCR dump: a box at a position, then whatever was read out of it. */
const DUMP = /^ {2}\d+,\d+ \d+×\d+ +/;

const dumpRows = (text: string) => text.split('\n').filter((line) => DUMP.test(line));

/**
 * A working directory holding the cache the scanner would otherwise download, so a run reaches no network. The
 * scanner's `CACHE` is relative, which is why this works at all: the directory a subprocess runs in decides where its
 * cache is, so no flag or stub is needed to move it.
 *
 * All three files are load-bearing, measured rather than reasoned about — seeded with the game master alone, a `parse`
 * run prints two `Downloading` lines. Only its *contents* matter: `loadGameData` throws without a CP multiplier for
 * every level, where an empty icon index and string table it takes in its stride. That emptiness is what lets the
 * stderr below be asserted — no form means no icon to fetch, so an empty stderr is exactly the claim that the seeded
 * cache was read rather than merely present.
 *
 * `extra` is appended to those templates for the tests that need a form to exist, and defaults to none so every other
 * caller keeps that emptiness. `icons` names what the index holds and writes each file beside it: the index is what
 * carries a name onto a form, deciding whether a family counts as drawn, and the files are what keep a drawn one off
 * the network. Their contents are arbitrary but they have to decode, an icon that does not being reported.
 */
function reads(extra: readonly unknown[] = [], icons: readonly string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'inventory-cli-'));
  const cache = join(dir, '.cache', 'inventory');
  const levels = Array.from({ length: 100 }, (_, i) => 0.1 + i / 100);

  mkdirSync(cache, { recursive: true });
  writeFileSync(
    join(cache, GAME_MASTER_CACHE),
    JSON.stringify([
      { templateId: 'PLAYER_LEVEL_SETTINGS', data: { playerLevel: { cpMultiplier: levels } } },
      ...extra,
    ]),
  );
  writeFileSync(join(cache, 'english.json'), JSON.stringify({ data: [] }));
  writeFileSync(join(cache, ICON_CACHE), JSON.stringify({ tree: icons.map((path) => ({ path })) }));

  if (icons.length > 0) {
    mkdirSync(join(cache, 'icons'), { recursive: true });

    for (const [at, name] of icons.entries()) {
      const pixel = Uint8Array.of(at % 2 === 0 ? 255 : 0, 0, at % 2 === 0 ? 0 : 255, 255);

      writeFileSync(join(cache, 'icons', name), encodePng({ width: 1, height: 1, data: pixel }));
    }
  }

  return dir;
}

/**
 * The `options` block of the script's own `parseArgs` call, and the flag names in it. Read off the source because the
 * options are a literal inside a top-level call, which a test cannot import without running the script. Matched as the
 * block first and its keys second rather than as whole option lines, a pattern wanting `{ type:` on the key's own line
 * stopping at the first option `prettier` has wrapped.
 *
 * That failure is the one to design against, because a check inspecting its own source fails *open*: a flag that drops
 * out of this list is one the comparisons below then agree about. So it is cross-checked against a count that does not
 * read the names at all.
 */
const OPTIONS = /\n {2}options: \{\n([\s\S]*?)\n {2}\},\n/.exec(SOURCE)?.[1] ?? '';
const FLAGS = [...OPTIONS.matchAll(/^ {4}'([a-z-]+)':/gm)].map(([, flag]) => flag as string);

/**
 * Every top-level entry of that block, counted without reading its name, so that a key written in a form the name
 * pattern does not recognise makes the two disagree. A line opening with `}` is a wrapped option's own close rather
 * than an entry of its own.
 */
const ENTRIES = OPTIONS.split('\n').filter((line) => /^ {4}[^\s}]/.test(line)).length;

test('the flags are read off `parseArgs` whole, not some readable subset of it', () => {
  expect(OPTIONS, 'the `options` block was not found, so every claim about flags below is vacuous').not.toBe('');
  expect(FLAGS.length, 'an option is declared in a form the flag pattern cannot read').toBe(ENTRIES);
  expect(FLAGS).toEqual(expect.arrayContaining(['out', 'scroll', 'refresh', 'verbose']));
});

/**
 * Which flags the script says each command acts on, read off its `HONOURED` table. The block is captured first and its
 * keys matched inside it for the reasons the options block above is, and the key pattern names no command, so a command
 * this test has never heard of is read rather than skipped.
 *
 * Naming the three was the hole: a `watch:` entry added to the table was checked by nothing, the pattern not seeing it
 * and the union below being taken over only what the pattern read. The same fail-open shape — a reader that matches
 * less is compared against less.
 */
const TABLE = /\nconst HONOURED[^=]*= \{\n([\s\S]*?)\n\};\n/.exec(SOURCE)?.[1] ?? '';
const HONOURED = new Map(
  [...TABLE.matchAll(/^ {2}([a-z-]+): \[([\s\S]*?)\],$/gm)].map(([, command, list]) => [
    command as string,
    new Set([...(list ?? '').matchAll(/'([a-z-]+)'/g)].map(([, flag]) => flag as string)),
  ]),
);

/**
 * The flags the synopsis offers each command, parsed once out of one `help` run. Split on the command lines rather than
 * read whole, which is what makes the comparison per command rather than a flat set — and a flat set was the hole here
 * before: `--serial` sat on the `scan` line alone while `snap` honoured it, and nothing could say so.
 */
const ADVERTISED = run(process.execPath, [SCRIPT, 'help']).then(
  ({ stderr }) =>
    new Map(
      stderr
        .split(/^ {2}pnpm inventory /m)
        .slice(1)
        .map((chunk) => {
          // A continuation of the command above is indented past it; a line sitting at the margin is prose beneath the
          // synopsis, and the flags it names in passing are not an offer to the last command listed.
          const lines = chunk.split('\n').filter((line) => !/^ {2}\S/.test(line));

          return [
            /^([a-z]+)/.exec(chunk)?.[1] ?? '',
            new Set([...lines.join('\n').matchAll(/--([a-z-]+)/g)].map(([, flag]) => flag as string)),
          ];
        }),
    ),
);

/**
 * That `help` answers at all, which is less obvious than it looks: the synopsis is cut out of the script's own source
 * with a regular expression, and `?.[0]` on a miss makes `console.error(undefined)` print `undefined` and exit 0. So a
 * usage block reworded past that pattern breaks the help text and reports success.
 */
test('`help` prints the synopsis and exits 0', async () => {
  const { stdout, stderr } = await run(process.execPath, [SCRIPT, 'help']);

  expect(stderr).toContain('pnpm inventory scan');
  expect(stderr).toContain('pnpm inventory snap');
  expect(stderr).toContain('pnpm inventory parse');
  expect(stdout).toBe('');
});

/** `--help` is `help` wherever it goes, rather than a flag refused because the command beside it does not act on it. */
test.each([[[]], [['scan']], [['parse', 'x.png']]])(
  '`--help` after %j prints the synopsis and exits 0',
  async (args) => {
    const { stdout, stderr } = await run(process.execPath, [SCRIPT, ...args, '--help']);

    expect(stderr).toContain('pnpm inventory scan');
    expect(stdout).toBe('');
  },
);

/**
 * That `HONOURED` names every flag `parseArgs` accepts and invents none: a flag in neither list is one no command acts
 * on, and one in the table but not the options is one no command could be given.
 *
 * It is also what keeps the two patterns above honest. A source reader that stops matching returns *less*, so the
 * comparisons would agree about a shrinking set; here the union has to equal the options block, which a half-read
 * table cannot do.
 *
 * `--help` is the one flag outside it, standing in for the `help` command rather than being acted on by one.
 */
test('`HONOURED` accounts for every flag `parseArgs` accepts, and no others', () => {
  const acted = FLAGS.filter((flag) => flag !== 'help');

  expect(TABLE, 'the `HONOURED` table was not found, so every claim about commands below is vacuous').not.toBe('');
  expect([...new Set([...HONOURED.values()].flatMap((flags) => [...flags]))].sort()).toStrictEqual(acted.sort());
});

/**
 * The table and the synopsis name the same commands, which is what makes the per-command comparison below total. Each
 * direction is a live bug otherwise: a table entry with no synopsis line is a command whose flags are undocumented, and
 * a synopsis line with no table entry is a command with no gate at all, silently ignoring every flag given to it — the
 * very thing the table is here to stop.
 */
test('the table and the synopsis name the same commands', async () => {
  const advertised = await ADVERTISED;

  expect([...HONOURED.keys()].sort(), 'a command is in the table or the synopsis but not both').toStrictEqual(
    [...advertised.keys()].sort(),
  );
});

/**
 * Each command's synopsis line lists exactly the flags that command acts on. Compared as sets per command, because both
 * weaker forms have already let real drift through: a substring search is prefix-blind, so `--out` read as documented
 * the moment `--output` was, and a flat set over the whole synopsis could not see `--serial` sitting on the `scan` line
 * while `snap` honoured it too.
 */
test('the synopsis lists each command the flags it acts on, and only those', async () => {
  const advertised = await ADVERTISED;

  for (const [command, honoured] of HONOURED) {
    const offered = advertised.get(command) ?? new Set<string>();

    expect([...honoured].sort(), `the ${command} synopsis disagrees with what ${command} acts on`).toStrictEqual(
      [...offered].sort(),
    );
  }
});

/**
 * A flag a command does not act on is refused rather than ignored. `parse --out inventory.csv` wrote no CSV and said
 * nothing, which is the failure worth closing: a flag that reads as accepted and does nothing is worse than one
 * rejected, because the run looks like it worked.
 */
test('a flag its command does not act on is refused, not ignored', async () => {
  // Seeded even though the refusal comes before any reading, so that this stays off the network in the case that
  // matters: with the refusal gone, the run goes on to `parse` the capture for real.
  const cwd = reads();

  try {
    const failure = await run(process.execPath, [SCRIPT, 'parse', '--out', 'x.csv', CAPTURE], { cwd }).catch(
      (error: unknown) => error,
    );

    expect(failure).toMatchObject({ code: 1 });
    expect((failure as { stderr: string }).stderr).toContain('parse does not act on --out');

    // The usage goes with the complaint, since the list the flag was not on is what answers it.
    expect((failure as { stderr: string }).stderr).toContain('pnpm inventory parse');
  } finally {
    rmSync(cwd, { recursive: true });
  }
});

// That the gate is not simply refusing everything is held by the `--verbose` test below, which runs `parse --verbose`
// to completion and asserts an empty stderr — a flag `parse` does act on, getting past this and leaving nothing behind.

/**
 * A command the script does not know is a failure rather than a silent no-op, and it says what the commands are. The
 * exit code is the half that matters: `help` and a typo print the same text.
 *
 * The names off `Object.prototype` are here because they got through. `HONOURED` is a plain object, so looking one up
 * answered an inherited function, the guard found it truthy, and the flag filter called `.includes` on a function and
 * threw a `TypeError` over the usage. Each needs a flag beside it to show it, an empty list never invoking the filter.
 */
test('an unknown command prints the usage and fails', async () => {
  for (const command of ['scna', 'toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__']) {
    const failure = await run(process.execPath, [SCRIPT, command, '--verbose']).catch((error: unknown) => error);

    expect(failure, `\`${command}\` did not fail`).toMatchObject({ code: 1 });
    expect((failure as { stderr: string }).stderr, `\`${command}\` printed no usage`).toContain('pnpm inventory scan');
  }
});

/** `parse` with no file named is the same: the guard on it is a length, and a missing argument must not read as one. */
test('`parse` with no file prints the usage and fails', async () => {
  const failure = await run(process.execPath, [SCRIPT, 'parse']).catch((error: unknown) => error);

  expect(failure).toMatchObject({ code: 1 });
  expect((failure as { stderr: string }).stderr).toContain('pnpm inventory parse');
});

/**
 * That the `--search` example the usage advertises is one the phone can actually be sent. The two know nothing about
 * each other, so a whitelist tightened without the example in mind would leave the one term a reader is told to type
 * failing on the phone with every other test here passing. Taken out of the synopsis rather than written again, so
 * what is checked is what a reader is told.
 */
test('the `--search` term the usage advertises is one the phone can be sent', () => {
  const advertised = /--search '([^']+)'/.exec(SOURCE)?.[1];

  expect(advertised, 'the usage no longer shows a quoted `--search` example, so this pins nothing').toBeTruthy();
  expect(typeable(advertised ?? '')).toBe(true);
});

/**
 * A `--search` term `type` would refuse is refused before the phone is opened, and for the same reason the name above
 * is: the alternative is driving the phone into storage and onto the search box before anything says the term was never
 * going to be sent, which leaves storage open with the keyboard up and nothing captured.
 */
test('`snap` refuses an untypeable `--search`, before it opens the phone', async () => {
  const failure = await run(process.execPath, [SCRIPT, 'snap', '--search', '+burmy (sandy)']).catch(
    (error: unknown) => error,
  );
  const { stderr } = failure as { stderr: string };

  expect(failure).toMatchObject({ code: 1 });
  expect(stderr).toContain('characters the phone cannot be sent');
  expect(stderr, 'the phone was reached before the term was checked').not.toContain('adb');
});

/**
 * That a term the box cannot be cleared of is refused, and before the phone is opened. This is the half that makes the
 * count safe rather than lucky: a caller cannot hand over a term longer than the clear can remove without being told.
 *
 * The length is taken off `CLEAR_KEYS` rather than written out, so raising or lowering the clear moves this with it. A
 * run of `a`s because `typeable` has to pass first — the refusal under test is the length and not the characters.
 */
test('`snap` refuses a `--search` longer than the box can be cleared of, before it opens the phone', async () => {
  const failure = await run(process.execPath, [SCRIPT, 'snap', '--search', 'a'.repeat(CLEAR_KEYS + 1)]).catch(
    (error: unknown) => error,
  );
  const { stderr } = failure as { stderr: string };

  expect(failure).toMatchObject({ code: 1 });
  expect(stderr).toContain(`more than the ${CLEAR_KEYS} the box can be cleared of`);
  expect(stderr, 'the phone was reached before the length was checked').not.toContain('adb');
});

/**
 * An empty `--search` is refused too, which `typeable` alone does not do: its pattern is `*`-quantified, so `''` passes
 * it, and spaces are stripped before the test, so a run of them passes as well. Both are terms that name nothing — an
 * empty search matches everything, and the snap would be of whatever the grid showed first under a name saying it is
 * something else. `--search "$TERM"` with `TERM` unset is how either one reaches here.
 */
test.for([
  ['empty', ''],
  ['whitespace-only', '   '],
] as const)('`snap` refuses a %s `--search`, before it opens the phone', async ([, term]) => {
  const failure = await run(process.execPath, [SCRIPT, 'snap', '--search', term]).catch((error: unknown) => error);
  const { stderr } = failure as { stderr: string };

  expect(failure).toMatchObject({ code: 1 });
  expect(stderr).toContain('--search needs a term');
  expect(stderr, 'the phone was reached before the term was checked').not.toContain('adb');
});

/**
 * The dump of what OCR read, and the raw readings beneath the answer, are printed only for `--verbose`; the answer is
 * the same either way.
 *
 * Asserted as the whole output rather than the dump alone, the claim being that the flag adds lines after the answer
 * and changes nothing in it: a gate that reordered or dropped one of the fields would satisfy any count of dump rows.
 */
test('the OCR dump and the raw readings are printed only with `--verbose`', async () => {
  const cwd = reads();

  try {
    const [quiet, loud] = await Promise.all([
      run(process.execPath, [SCRIPT, 'parse', CAPTURE], { cwd }),
      run(process.execPath, [SCRIPT, 'parse', '--verbose', CAPTURE], { cwd }),
    ]);

    expect(quiet.stdout, 'the answer was not printed').toMatch(/^species {2,}/m);
    expect(dumpRows(quiet.stdout), 'the dump was printed without the flag asking for it').toStrictEqual([]);
    expect(quiet.stdout, 'the raw readings were printed without the flag asking for them').not.toMatch(
      /^(detail|identity):/m,
    );
    expect(dumpRows(loud.stdout).length, '`--verbose` printed no dump at all').toBeGreaterThan(0);
    expect(loud.stdout, '`--verbose` printed no raw readings').toMatch(/^identity:/m);
    expect(loud.stdout.startsWith(quiet.stdout), '`--verbose` changed the answer rather than only adding to it').toBe(
      true,
    );

    // Nothing was downloaded, which is what says the seeded cache was read rather than merely present. Both runs carry
    // that claim, `Downloading` being outside the `--verbose` gate: a missing file would name itself either way.
    expect(quiet.stderr).toBe('');
    expect(loud.stderr).toBe('');
  } finally {
    rmSync(cwd, { recursive: true });
  }
});

/**
 * Two forms the numbers cannot separate, the cheapest thing that makes `iconsFor` report at all: one dex, two
 * non-costume forms identical in types and all three stats, and no icon for either in the empty index.
 *
 * That last part is what keeps this hermetic. A family short of an icon can never be narrowed, so it is named ahead of
 * any download; a family the artwork *could* settle would send the run to the network for an icon apiece.
 */
const AMBIGUOUS = ['SPINDA_00', 'SPINDA_01'].map((form) => ({
  templateId: `V0327_POKEMON_${form}`,
  data: {
    pokemonSettings: {
      pokemonId: 'SPINDA',
      form,
      type: 'POKEMON_TYPE_NORMAL',
      stats: { baseAttack: 1, baseDefense: 1, baseStamina: 1 },
    },
  },
}));

/**
 * The preamble `iconsFor` narrates before it has an answer is printed only for `--verbose`. That is the whole of what
 * the flag holds back; the downloads print either way, which `progress.test.mts` pins.
 *
 * The `--verbose` run is asserted *first*, on purpose: the seeded cache is otherwise empty enough that none of these
 * lines is reached, so a quiet assertion alone would pass as well for a gate deleted outright as for one that works.
 * Between them the two also place `showProgress` — one made below `iconsFor` rather than above it leaves the preamble
 * in the quiet run, which the second assertion sees.
 */
test('the progress preamble is printed only with `--verbose`', async () => {
  const cwd = reads(AMBIGUOUS);

  try {
    const [quiet, loud] = await Promise.all([
      run(process.execPath, [SCRIPT, 'parse', CAPTURE], { cwd }),
      run(process.execPath, [SCRIPT, 'parse', '--verbose', CAPTURE], { cwd }),
    ]);

    expect(
      loud.stderr,
      'the preamble was never reached, so the quiet claim below would hold for no gate at all',
    ).toContain('Spinda (2)');
    expect(quiet.stderr, 'the preamble was printed without the flag asking for it').toBe('');
  } finally {
    rmSync(cwd, { recursive: true });
  }
});

/**
 * The one warning no `Downloading` line can lend a subject to. `cached` reads the status and not the body, so a 200
 * carrying an error page is cached and fails in the decode past it, after the download has finished printing — and
 * this line is written as a continuation, with no subject of its own.
 *
 * Seeded rather than served, which is what makes it hermetic: the week's grace reads the file without a word, and
 * bytes that will not parse do so however they arrived. Matched as *a* URL rather than the index's own, which
 * `download.mts` does not export: the claim is that the line names the file it is about.
 *
 * That the copy is gone afterwards is the half `progress.test.mts` cannot reach — there the bad bytes are ones it
 * downloaded, here ones it only read, so a fix that dropped the file on the write path alone would pass that test and
 * leave this run reading the same HTML every day for a week.
 */
test('a cached file that will not decode is reported against its own URL, and not kept', async () => {
  const cwd = reads();
  const index = join(cwd, '.cache', 'inventory', ICON_CACHE);

  writeFileSync(index, '<html>502 Bad Gateway</html>');

  try {
    const { stderr } = await run(process.execPath, [SCRIPT, 'parse', CAPTURE], { cwd });
    const [warning, ...rest] = stderr.split('\n').filter((line) => line.includes('narrowed by its artwork'));

    expect(rest, 'the icon index was reported more than once, so the line below is one of several').toStrictEqual([]);
    expect(warning).toMatch(/^ {2}https:\/\/\S+: .+; no form is narrowed by its artwork$/);
    expect(existsSync(index), 'the copy that would not decode was left to be read again for the week').toBe(false);
  } finally {
    rmSync(cwd, { recursive: true });
  }
});

/**
 * The listing that parses and is still no good — the stale directory's failure by another route: every name it carries
 * resolves, so a reader that takes it answers confidently about the forms it names and says nothing about the ones it
 * dropped.
 *
 * Seeded with the pair's own icons and both their names, which is what makes this two-sided. The same cache without
 * `truncated` is the test above, where the count prints, so `Reading 2 form icons` going missing is the refusal and
 * the warning in its place is where it says so. Reverting the guard prints the count and no warning — the mutation.
 *
 * `--verbose` because the count is behind it, so the absence is of a line the run would otherwise have reached.
 */
test('a listing that says it is truncated is refused rather than half read', async () => {
  const cwd = reads(AMBIGUOUS, ['pm327.f00.icon.png', 'pm327.f01.icon.png']);
  const index = join(cwd, '.cache', 'inventory', ICON_CACHE);
  const tree = ['pm327.f00.icon.png', 'pm327.f01.icon.png'].map((path) => ({ path }));

  writeFileSync(index, JSON.stringify({ tree, truncated: true }));

  try {
    const { stderr } = await run(process.execPath, [SCRIPT, 'parse', '--verbose', CAPTURE], { cwd });
    const [warning, ...rest] = stderr.split('\n').filter((line) => line.includes('narrowed by its artwork'));

    expect(rest, 'the icon index was reported more than once, so the line below is one of several').toStrictEqual([]);
    expect(warning).toMatch(/^ {2}https:\/\/\S+: the listing is truncated, .+; no form is narrowed by its artwork$/);
    expect(stderr, 'the truncated listing was read, so some of the artwork was taken for all of it').not.toContain(
      'Reading 2 form icons',
    );
    expect(existsSync(index), 'the truncated copy was left to be read again for the week').toBe(false);
  } finally {
    rmSync(cwd, { recursive: true });
  }
});

/**
 * The other half of that preamble, which the test above cannot reach. `AMBIGUOUS` alone leaves both Spinda forms short
 * of an icon, so the family lands in `short` rather than `drawn` and `Reading N form icons` is never printed at all —
 * measured by reverting that line to `console.error`, which left the whole suite green.
 *
 * Giving the index both icons and writing both files is what moves the family across, so the count prints with nothing
 * fetched. Hence a count here where the test above asserts the families: the two lines are gated together and reached
 * apart.
 */
test('the icon count in the preamble is printed only with `--verbose`', async () => {
  const cwd = reads(AMBIGUOUS, ['pm327.f00.icon.png', 'pm327.f01.icon.png']);

  try {
    const [quiet, loud] = await Promise.all([
      run(process.execPath, [SCRIPT, 'parse', CAPTURE], { cwd }),
      run(process.execPath, [SCRIPT, 'parse', '--verbose', CAPTURE], { cwd }),
    ]);

    expect(loud.stderr, 'the pair was not drawn, so the quiet claim below would hold for no gate at all').toContain(
      'Reading 2 form icons',
    );
    expect(quiet.stderr, 'the icon count was printed without the flag asking for it').toBe('');
  } finally {
    rmSync(cwd, { recursive: true });
  }
});
