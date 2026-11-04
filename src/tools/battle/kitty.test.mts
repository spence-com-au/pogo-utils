import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, expect, test, vi } from 'vitest';
import { columnsFor, pictures } from './kitty.mts';

/** A terminal that answers whatever is written to it with `answer`, keeping what was written and its raw mode. */
function terminal(answer: (written: string) => string | undefined) {
  const modes: boolean[] = [];
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: (raw: boolean) => modes.push(raw),
  }) as unknown as NodeJS.ReadStream;
  let written = '';
  const output = new Writable({
    write(chunk: Buffer, _encoding, done) {
      written += chunk.toString();
      const reply = answer(chunk.toString());

      if (reply !== undefined) {
        setImmediate(() => input.push(reply));
      }

      done();
    },
  }) as unknown as NodeJS.WriteStream;

  return { input, output, modes, written: () => written };
}

/** The file a query or a picture names, out of its payload. */
const pathOf = (escape: string) => Buffer.from(/;([\w+/=]*)/.exec(escape)?.[1] ?? '', 'base64').toString();

/** Ghostty's answer: the picture drawn, cells 10×21, and its device attributes. */
const GHOSTTY = '\x1b_Gi=31;OK\x1b\\\x1b[6;21;10t\x1b[?62;22c';

afterEach(() => vi.useRealTimers());

test('draws each frame from a file of its own, the size of a cell as the terminal says', async () => {
  const { input, output, modes, written } = terminal(() => GHOSTTY);
  const drawn = await pictures(input, output);

  expect(drawn?.cell).toEqual({ width: 10, height: 21 });
  expect(modes).toEqual([true, false]);
  expect(pathOf(written())).toMatch(/tty-graphics-protocol-/);

  const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const first = drawn?.picture({ width: 2, height: 1, data }, 24) ?? '';
  const second = drawn?.picture({ width: 2, height: 1, data }, 24) ?? '';

  expect(first.startsWith('\x1b_Ga=T,i=1,t=t,f=32,s=2,v=1,r=24,C=1,q=2;')).toBe(true);
  expect(readFileSync(pathOf(first))).toEqual(Buffer.from(data));
  expect(pathOf(second)).not.toBe(pathOf(first));

  drawn?.close();

  expect(existsSync(dirname(pathOf(first)))).toBe(false);
});

test('draws nothing for a frame whose file cannot be written, rather than throwing', async () => {
  const { input, output } = terminal(() => GHOSTTY);
  const drawn = await pictures(input, output);

  // The directory gone, as a full disk or a cleaned `/tmp` leaves it.
  drawn?.close();

  expect(drawn?.picture({ width: 1, height: 1, data: new Uint8Array(4) }, 24)).toBe('');
});

test('draws nothing where the terminal answers only its device attributes', async () => {
  const { input, output, written } = terminal(() => '\x1b[?62;22c');

  expect(await pictures(input, output)).toBeUndefined();
  expect(existsSync(dirname(pathOf(written())))).toBe(false);
});

test('draws nothing where the terminal cannot read the file, as one on another machine', async () => {
  const { input, output } = terminal(() => '\x1b_Gi=31;EBADF:could not open\x1b\\\x1b[6;21;10t\x1b[?62;22c');

  expect(await pictures(input, output)).toBeUndefined();
});

test('draws nothing where the terminal never answers, giving its input back', async () => {
  vi.useFakeTimers();
  const { input, output, modes } = terminal(() => undefined);
  const drawn = pictures(input, output);

  await vi.advanceTimersByTimeAsync(1_000);

  expect(await drawn).toBeUndefined();
  expect(modes).toEqual([true, false]);
});

test('gives a picture as many columns as its shape needs', () => {
  // The phone's 360×802 drawn 40 rows tall in 10×21 cells is 840 pixels tall and so 377 across.
  expect(columnsFor({ width: 360, height: 802 }, 40, { width: 10, height: 21 })).toBe(38);
});
