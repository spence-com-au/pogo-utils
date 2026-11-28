/**
 * The command line itself, driven as a subprocess. `scripts/inventory.mts` is the one part of the scanner no unit test
 * reaches — nothing imports it, so the whole suite passes a script that cannot start, a `parseArgs` that rejects a flag
 * the usage advertises, and a usage block the script can no longer find in its own source.
 *
 * Driven rather than imported because importing it runs it: `parseArgs` and the command dispatch are both at the top
 * level, so a test that loaded the module would parse Vitest's own argv and then try to drive a phone. A subprocess is
 * also the interface a person uses.
 *
 * Nothing here reaches the network or a phone: every test is refused on the flag gate or the usage before `scan` or
 * `dex` opens one. Driving those two to their end, which both need a phone, is the job of `phone.test.mts` and the
 * `phone-dex-*.test.mts` against a stand-in.
 */

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

const run = promisify(execFile);

const SCRIPT = fileURLToPath(new URL('../../../scripts/inventory.mts', import.meta.url));
const SOURCE = readFileSync(SCRIPT, 'utf8');

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
  expect(FLAGS).toEqual(expect.arrayContaining(['out', 'refresh', 'serial']));
});

/**
 * Which flags the script says each command acts on, read off its `HONOURED` table. The block is captured first and its
 * keys matched inside it for the reasons the options block above is, and the key pattern names no command, so a command
 * this test has never heard of is read rather than skipped.
 *
 * Naming the commands would fail open: a `watch:` entry added to the table would be checked by nothing, the pattern not
 * seeing it and the union below being taken over only what the pattern read. A reader that matches less is compared
 * against less.
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
 * read whole, which is what makes the comparison per command rather than a flat set, which would pass a `--serial`
 * offered on the `scan` line alone while `dex` honoured it.
 */
const ADVERTISED = run(process.execPath, [SCRIPT, 'help']).then(
  ({ stdout }) =>
    new Map(
      stdout
        .split(/^ {2}pnpm inventory /m)
        .slice(1)
        .map((chunk) => {
          // A command's own lines are indented past it; one at the margin or two in is the shared options or the prose
          // beneath them, and the flags it names are not an offer to the last command listed.
          const lines = chunk.split('\n').filter((line, i) => i === 0 || !/^ {0,2}\S/.test(line));

          return [
            /^([a-z]+)/.exec(chunk)?.[1] ?? '',
            new Set([...lines.join('\n').matchAll(/--([a-z-]+)/g)].map(([, flag]) => flag as string)),
          ];
        }),
    ),
);

/**
 * That `help` answers at all, which is less obvious than it looks: the synopsis is cut out of the script's own source
 * with a regular expression, and `?.[0]` on a miss makes `console.log(undefined)` print `undefined` and exit 0. So a
 * usage block reworded past that pattern breaks the help text and reports success.
 *
 * On stdout, as `pnpm phone` and `pnpm battle` print theirs, so that `help | less` or `help > usage.txt` has it to
 * read; the usage beside a refusal goes to stderr with the refusal.
 */
test('`help` prints the synopsis and exits 0', async () => {
  const { stdout, stderr } = await run(process.execPath, [SCRIPT, 'help']);

  expect(stdout).toContain('pnpm inventory scan');
  expect(stdout).toContain('pnpm inventory dex');
  expect(stderr).toBe('');
});

/** `--help` is `help` wherever it goes, rather than a flag refused because the command beside it does not act on it. */
test.each([[[]], [['scan']], [['dex']]])('`--help` after %j prints the synopsis and exits 0', async (args) => {
  const { stdout, stderr } = await run(process.execPath, [SCRIPT, ...args, '--help']);

  expect(stdout).toContain('pnpm inventory scan');
  expect(stderr).toBe('');
});

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
 * while `dex` honoured it too.
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
 * A flag a command does not act on is refused rather than ignored: a flag that reads as accepted and does nothing is
 * worse than one rejected, because the run looks like it worked. The refusal comes before `scan` opens the phone, so no
 * device or network is reached. `--keep-screens` is a real flag `dex` acts on, so this is a flag on the wrong command
 * rather than a typo the parser turns away on its own.
 */
test('a flag its command does not act on is refused, not ignored', async () => {
  const failure = await run(process.execPath, [SCRIPT, 'scan', '--keep-screens', 'x']).catch((error: unknown) => error);

  expect(failure).toMatchObject({ code: 1 });
  expect((failure as { stderr: string }).stderr).toContain('scan does not act on --keep-screens');

  // The usage goes with the complaint, since the list the flag was not on is what answers it.
  expect((failure as { stderr: string }).stderr).toContain('pnpm inventory scan');
});

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
    const failure = await run(process.execPath, [SCRIPT, command, '--refresh']).catch((error: unknown) => error);

    expect(failure, `\`${command}\` did not fail`).toMatchObject({ code: 1 });
    expect((failure as { stderr: string }).stderr, `\`${command}\` printed no usage`).toContain('pnpm inventory scan');
  }
});
