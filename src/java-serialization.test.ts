/**
 * The bytes `dumps` writes are this module's whole contract: a JVM reads them or it does not. So the small streams
 * below are written out as literal bytes derived from Java's own `ObjectStreamConstants` and the modified-UTF-8 rules
 * rather than read back out of this module, a test asserting whatever the writer emits agreeing with a defect as
 * readily as with a fix.
 *
 * One stream was written by a real JVM, and is the only thing here that can see an error reader and writer share: a
 * mistyped serialVersionUID, a class descriptor laid out wrongly or a handle numbered from the wrong place would pass
 * every round trip, both halves agreeing on the same mistake.
 *
 * The larger shapes go through `loads`, which is the one check that reaches the handle table: back-references are
 * positional, so a value written at the wrong size shifts every handle after it. What a round trip cannot see is
 * anything the reader recomputes rather than reads — the map's capacity — so that one is asserted in the bytes.
 */

import { expect, test } from 'vitest';

import { JavaSer, type JavaValue } from './java-serialization.js';

const { box, dumps, loads } = JavaSer;

/** A stream as the literal bytes a hand-derived expectation is written as. */
const stream = (...values: number[]) => Uint8Array.from(values);

/** A stream from the hex a JVM's bytes were pasted as, since `Buffer` is a Node global this tsconfig does not declare. */
const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));

/** The bytes an ASCII string takes up in a stream, modified UTF-8 and ASCII agreeing over that range. */
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/** Every offset at which one byte sequence occurs, which is how a back-reference is counted rather than assumed. */
function positions(haystack: Uint8Array, needle: readonly number[]): number[] {
  const found = [];

  for (let at = 0; at <= haystack.length - needle.length; at += 1) {
    if (needle.every((byte, offset) => haystack[at + offset] === byte)) {
      found.push(at);
    }
  }

  return found;
}

/**
 * The root as the map it is. `loads` answers any of the four value shapes, so a test that wants the map says so and
 * fails here rather than reaching past a cast that would have made the mismatch somebody else's error.
 */
function rootMap(bytes: Uint8Array): Map<JavaValue, JavaValue> {
  const root = loads(bytes);

  if (!(root instanceof Map)) {
    throw new Error(`expected a HashMap at the root, got ${root === null ? 'null' : typeof root}`);
  }

  return root;
}

/**
 * The `[capacity, size]` pair HashMap writes as its custom block data, for a map of that many entries. Found by
 * searching for the marker and asserting it matched once, since the obvious offset is wrong: the four bytes before it
 * are the threshold, not the capacity.
 */
function blockData(entries: number): [number, number] {
  const map = new Map<JavaValue, JavaValue>(Array.from({ length: entries }, (_, index) => [`k${index}`, null]));
  const bytes = dumps(map);
  const found = positions(bytes, [0x77, 0x08]); // TC_BLOCKDATA, then the eight bytes of payload

  if (found.length !== 1 || found[0] === undefined) {
    throw new Error(`${found.length} block-data markers in a ${entries}-entry stream, expected 1`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  return [view.getInt32(found[0] + 2), view.getInt32(found[0] + 6)];
}

test("the stream opens with Java's magic and version, and the whole of `null` is one byte", () => {
  // `0xaced` and version 5 are what a JVM looks for before it reads anything else, so a stream missing them is a file
  // PGSharp refuses however right the rest of it is. These five bytes are the smallest complete stream there is.
  expect(dumps(null)).toEqual(stream(0xac, 0xed, 0x00, 0x05, 0x70));
  expect(loads(stream(0xac, 0xed, 0x00, 0x05, 0x70))).toBe(null);
});

test('a stream written by a real JVM is read, and written back byte for byte', () => {
  // Produced by `ObjectOutputStream` on OpenJDK 21 from a `HashMap<String, Object>` holding "s" -> "v", "f" -> 0.5f,
  // "i" -> -7, "j" -> 1L << 40, "z" -> Boolean.TRUE and "n" -> null, the order the JVM iterates them in. It carries
  // every class descriptor this module writes (`HashMap`, `Float`, `Integer`, `Long`, `Boolean` and the `Number`
  // superclass, in full once and by reference after that), their serialVersionUIDs, the handle each one is numbered
  // with and HashMap's `loadFactor`, `threshold` and `[capacity, size]` block data.
  const jvm = fromHex(
    'aced0005737200116a6176612e7574696c2e486173684d61700507dac1c31660d103000246000a6c6f6164466163746f7249' +
      '00097468726573686f6c6478703f4000000000000c770800000010000000067400017374000176740001667372000f6a6176' +
      '612e6c616e672e466c6f6174daedc9a2db3cf0ec02000146000576616c7565787200106a6176612e6c616e672e4e756d6265' +
      '7286ac951d0b94e08b02000078703f00000074000169737200116a6176612e6c616e672e496e746567657212e2a0a4f78187' +
      '3802000149000576616c75657871007e0006fffffff97400016a7372000e6a6176612e6c616e672e4c6f6e673b8be490cc8f' +
      '23df0200014a000576616c75657871007e000600000100000000007400017a737200116a6176612e6c616e672e426f6f6c65' +
      '616ecd207280d59cfaee0200015a000576616c75657870017400016e7078',
  );

  const expected = new Map<JavaValue, JavaValue>([
    ['s', 'v'],
    ['f', box('F', 0.5)],
    ['i', box('I', -7)],
    ['j', box('J', 1n << 40n)],
    ['z', box('Z', true)],
    ['n', null],
  ]);

  expect(rootMap(jvm)).toEqual(expected);
  expect(dumps(expected)).toEqual(jvm);
});

test('a stream that is not one is refused rather than read as far as it happens to parse', () => {
  expect(() => loads(stream(0x00, 0x00, 0x00, 0x05, 0x70))).toThrow(/bad magic\/version/);
  expect(() => loads(stream(0xac, 0xed, 0x00, 0x04, 0x70))).toThrow(/bad magic\/version/);

  // Trailing bytes are the half-read file, and the expensive direction: the root parsed, so every check above this one
  // passed, and a backup would have been built from whatever the first object in some other format happened to be.
  expect(() => loads(stream(0xac, 0xed, 0x00, 0x05, 0x70, 0x00))).toThrow(/^1 trailing bytes/);
});

test('U+0000 takes two bytes, which is the whole of what makes this modified UTF-8', () => {
  // Java writes NUL as `C0 80` so that no byte inside a string is ever zero. A plain `00` is a different string *and* a
  // different length, so a name carrying one would desynchronise every byte after it rather than coming back wrong.
  expect(dumps('\u0000')).toEqual(stream(0xac, 0xed, 0x00, 0x05, 0x74, 0x00, 0x02, 0xc0, 0x80));

  // The control is the encoder a second implementation reaches for, and it disagrees in both bytes and length.
  expect([...new TextEncoder().encode('\u0000')]).toEqual([0x00]);

  expect(loads(dumps('\u0000'))).toBe('\u0000');
});

test('a character outside the BMP travels as its two surrogates, three bytes each', () => {
  // U+1F600 is `D83D DE00` in UTF-16 and modified UTF-8 encodes the code *units*, so six bytes where a code-point
  // encoder writes four. Derived from the high surrogate: `0xE0 | (0xD83D >> 12)` is `0xED`, then
  // `0x80 | ((0xD83D >> 6) & 0x3F)` is `0xA0` and `0x80 | (0xD83D & 0x3F)` is `0xBD`. The same three steps over
  // `0xDE00` give the other three bytes.
  const emoji = '\u{1F600}';

  expect(dumps(emoji)).toEqual(stream(0xac, 0xed, 0x00, 0x05, 0x74, 0x00, 0x06, 0xed, 0xa0, 0xbd, 0xed, 0xb8, 0x80));
  expect([...new TextEncoder().encode(emoji)]).toEqual([0xf0, 0x9f, 0x98, 0x80]);

  expect(loads(dumps(emoji))).toBe(emoji);
});

test('a sequence the stream cannot hold is refused, since a corrupt file otherwise reads as a short one', () => {
  // A length of 1 over a byte announcing a two-byte sequence: the bytes are all there, so the stream-level bounds check
  // passes and only the decoder can tell. Hand-patched from `dumps('a')` by swapping the payload byte.
  expect(() => loads(stream(0xac, 0xed, 0x00, 0x05, 0x74, 0x00, 0x01, 0xc2))).toThrow(/truncated modified UTF-8/);

  // `0xF0` leads a four-byte UTF-8 sequence, which is the one thing modified UTF-8 never writes — so a file encoded the
  // ordinary way is rejected here rather than decoded into a different string.
  expect(() => loads(stream(0xac, 0xed, 0x00, 0x05, 0x74, 0x00, 0x01, 0xf0))).toThrow(/invalid modified UTF-8 byte/);
});

test('the four things a value can be survive a round trip, nested inside each other', () => {
  const inner = new Map<JavaValue, JavaValue>([['deep', box('Z', true)]]);
  const root = new Map<JavaValue, JavaValue>([
    ['text', 'Melbourne Zoo'],
    ['count', box('I', -7)],
    ['hidden', box('J', 1n << 62n)],
    ['off', box('Z', false)],
    ['half', box('F', 0.5)],
    ['missing', null],
    ['nested', inner],
    ['\u0000', 'a key carries NUL as readily as a value does'],
  ]);

  // A nested map is the case the reader held wrongly once, its own fields having lived on the shared class descriptor:
  // that was correct only while no second instance of the class came between the write and the read back.
  expect(rootMap(dumps(root))).toEqual(root);
  expect(rootMap(dumps(root)).get('nested')).toEqual(inner);
});

test('a long round-trips exactly where a float cannot, which is why doubles travel as longs here', () => {
  // 2^53 + 1 is the smallest integer a JS number cannot hold, so a codec reading a long into a Number loses it and says
  // nothing: the value comes back one smaller and a hidden coordinate moves with it.
  const exact = (1n << 53n) + 1n;

  expect(Number(exact)).toBe(Number(exact - 1n));
  expect(loads(dumps(box('J', exact)))).toEqual(box('J', exact));

  // A negative long is what a reader reaching for `getBigUint64` loses, and the writer's `BigInt.asUintN(64, …)` is
  // not what saves it: `i8` takes each byte with `x & 0xffn` over an arithmetic `>>`, which is two's complement
  // already, so `asIntN` in its place writes the same eight bytes for every value in range. That conversion is
  // documentation rather than behaviour, and this assertion is about the reader's `getBigInt64`.
  expect(loads(dumps(box('J', -1n)))).toEqual(box('J', -1n));

  // `F` is four bytes and so lossy by construction, which is worth pinning because it is the reason the field above
  // exists: anything reaching for a float instead would lose a little of every value it carried.
  expect(Math.fround(0.1)).not.toBe(0.1);
  expect(loads(dumps(box('F', 0.1)))).toEqual(box('F', Math.fround(0.1)));
});

test("the writer's switch is the check a box's two fields cannot be, and it rejects the pair", () => {
  // A box holds its code beside its value and nothing at the type level ties them, so both of these type-check clean
  // and only the bytes can say. Before this check, `box('I', 'x')` wrote four zero bytes for `'x' >>> 24` and handed
  // back a stream of the right length that was wholly wrong.
  expect(() => dumps(box('J', 5))).toThrow(/^boxed java\.lang\.Long needs a BigInt value, got number/);
  expect(() => dumps(box('F', 1n))).toThrow(/^boxed java\.lang\.Float needs a Number value, got bigint/);

  // What the type *can* say, it does, so reaching the same throw with a string takes an assertion that it rejects one.
  // @ts-expect-error -- a string is no `BoxValue`, which is the compile-time half of the check below
  expect(() => dumps(box('I', 'x'))).toThrow(/^boxed java\.lang\.Integer needs a Number value, got string/);

  // An unsupported code fails at the call that named it instead, there being no field for it to be written to.
  // @ts-expect-error -- `D` is no `BoxCode` either, double being the width this codec does not box
  expect(() => box('D', 1)).toThrow(/^no boxed Java primitive for field type 'D'/);
});

test('a string said twice is written once and cited after that', () => {
  const twice = new Map<JavaValue, JavaValue>([
    ['first', 'Melbourne Zoo'],
    ['second', 'Melbourne Zoo'],
  ]);
  const bytes = dumps(twice);

  // Writing it twice is not merely longer. Handles are positional, so the second copy claims one and shifts every
  // handle after it, and a back-reference written before that shift now cites a different object altogether.
  expect(positions(bytes, ascii('Melbourne Zoo'))).toHaveLength(1);
  expect(rootMap(bytes)).toEqual(twice);
});

test('two equal strings share a handle where two equal boxes do not', () => {
  const shared = box('I', 1);
  const reused = new Map<JavaValue, JavaValue>([
    ['a', shared],
    ['b', shared],
  ]);
  const equal = new Map<JavaValue, JavaValue>([
    ['a', box('I', 1)],
    ['b', box('I', 1)],
  ]);

  // Strings are keyed by value and boxes by identity, and that is the right way round: two equal strings are one object
  // to anything reading them back, where two boxes are two cells a shared handle would quietly alias into one.
  expect(dumps(reused).length).toBeLessThan(dumps(equal).length);

  const back = rootMap(dumps(reused));

  expect(back.get('a')).toBe(back.get('b'));
  expect(rootMap(dumps(equal)).get('a')).not.toBe(rootMap(dumps(equal)).get('b'));
});

test('a string past what a two-byte length can say changes tag rather than overflowing it', () => {
  const longest = 'a'.repeat(0xffff);

  // The tag sits immediately after the four header bytes. `TC_STRING` carries a `u2` length, so one character more than
  // 65,535 has to become `TC_LONGSTRING` and an eight-byte one — truncating instead writes a length of zero.
  expect(dumps(longest)[4]).toBe(0x74);
  expect(dumps(`${longest}a`)[4]).toBe(0x7c);

  expect(loads(dumps(`${longest}a`))).toHaveLength(0x10000);

  // `utf`'s own `string too long for TC_STRING` throw is unreachable rather than uncovered: `string` is what routes a
  // long one to the other tag, and the only other caller is `classDesc`, which writes this module's own class and
  // field names. So no argument to `dumps` can be the string that trips it.
});

test("the map's capacity follows HashMap's own growth rather than its entry count", () => {
  // Capacity starts at 16 and doubles while the count exceeds three quarters of it, so twelve entries fit where
  // thirteen do not. The round trip cannot see this at all — the reader recomputes the capacity rather than reading it
  // — yet a JVM rehashes the table from these bytes, so a capacity disagreeing with the count is a map that loads
  // wrongly in the one consumer this file exists for.
  expect(blockData(12)).toEqual([16, 12]);
  expect(blockData(13)).toEqual([32, 13]);
});

/**
 * Everything below reaches a path `dumps` does not take, by patching a stream it wrote rather than writing bytes by
 * hand: a patched stream differs from a working one in exactly the thing the case is about. Each patch finds its own
 * offset and asserts the match was unique, the obvious offset being wrong often enough to matter — the four bytes of a
 * boxed value are not the last four, HashMap's own `TC_ENDBLOCKDATA` following them.
 */

const TC_NULL = 0x70,
  TC_REFERENCE = 0x71,
  TC_CLASSDESC = 0x72,
  TC_STRING = 0x74,
  TC_BLOCKDATA = 0x77,
  TC_ENDBLOCKDATA = 0x78,
  TC_BLOCKDATALONG = 0x7a;
const BASE_HANDLE = 0x7e0000;

/** The same stream with one byte sequence swapped for another, which need not be the same length. */
function splice(bytes: Uint8Array, find: readonly number[], replace: readonly number[]): Uint8Array {
  const found = positions(bytes, find);

  if (found.length !== 1 || found[0] === undefined) {
    throw new Error(`${found.length} matches for the sequence to patch, expected 1`);
  }

  const at = found[0];
  return Uint8Array.from([...bytes.subarray(0, at), ...replace, ...bytes.subarray(at + find.length)]);
}

/**
 * A handle number as the four bytes a `TC_REFERENCE` carries, written big-endian because that is what a stream is —
 * `Int32Array`'s own buffer is host-endian, so it would have read back differently on a big-endian machine.
 */
function handle(h: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, BASE_HANDLE + h, false);
  return [...bytes];
}

/** The `u2` length and bytes a field or class name takes up in a classdesc. */
const named = (text: string) => [0x00, text.length, ...ascii(text)];

/** A two-entry map, whose second value cites the first string and whose class descriptors are therefore all in play. */
const twoStrings = () =>
  dumps(
    new Map<JavaValue, JavaValue>([
      ['first', 'Melbourne Zoo'],
      ['second', 'Melbourne Zoo'],
    ]),
  );

test('a character between U+0080 and U+07FF takes two bytes rather than one or three', () => {
  // The middle band of modified UTF-8, which ASCII text never reaches and an emoji skips past. U+00E9 is `0xC3 0xA9`:
  // `0xC0 | (0xE9 >> 6)` is `0xC3` and `0x80 | (0xE9 & 0x3F)` is `0xA9` — the same two bytes ordinary UTF-8 writes, the
  // two encodings differing only at NUL and above the BMP.
  expect(dumps('é')).toEqual(stream(0xac, 0xed, 0x00, 0x05, 0x74, 0x00, 0x02, 0xc3, 0xa9));
  expect([...new TextEncoder().encode('é')]).toEqual([0xc3, 0xa9]);
  expect(loads(dumps('é'))).toBe('é');
});

/**
 * A stream that stops mid-object, which is what a half-written file looks like. Every reader that can run off the end
 * says so rather than reading `undefined` as a byte or letting `DataView` throw a bare `RangeError`: `u1` reads the slot
 * and tests it, `raw` compares the length it got against the length it asked for — a `subarray` past the end is short
 * rather than an error — and the fixed-width readers check the room first.
 */
test('a stream that stops short is refused at the byte that is missing', () => {
  const whole = twoStrings();

  // One byte short is the map's own closing TC_ENDBLOCKDATA, read through `u1`.
  expect(whole.at(-1)).toBe(TC_ENDBLOCKDATA);
  expect(() => loads(whole.subarray(0, whole.length - 1))).toThrow(/^truncated stream/);

  // Cut three bytes into HashMap's eight-byte block data, which `raw` is what asks for.
  const found = positions(whole, [TC_BLOCKDATA, 0x08]);
  expect(found).toHaveLength(1);
  expect(() => loads(whole.subarray(0, (found[0] ?? 0) + 2 + 3))).toThrow(/^truncated stream/);

  // Cut inside the two-byte version that follows the magic number, which `u2` reads.
  expect(() => loads(Uint8Array.of(0xac, 0xed, 0x00))).toThrow(/^truncated stream/);
});

test.for([
  { reader: 'i4', tcode: 'I', payload: [0x41, 0x42, 0x43, 0x44] },
  { reader: 'i8', tcode: 'J', payload: [0, 1, 2, 3, 4, 5, 6, 7] },
  { reader: 'f4', tcode: 'F', payload: [0x3f, 0x80, 0x00, 0x00] },
  { reader: 'f8', tcode: 'D', payload: [0x3f, 0xe0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00] },
  { reader: 'i2', tcode: 'S', payload: [0xff, 0xfe] },
  { reader: 'u2', tcode: 'C', payload: [0x00, 0x41] },
])('a $tcode field cut one byte short is refused by $reader', ({ tcode, payload }) => {
  // An Integer's `value` is the last thing in its stream, so a field redeclared at another width and given a payload
  // one byte short of it ends the stream inside that read.
  const bytes = dumps(box('I', 0x41424344));
  const declared = splice(bytes, [ascii('I')[0] ?? 0, ...named('value')], [ascii(tcode)[0] ?? 0, ...named('value')]);
  const cut = splice(declared, [0x41, 0x42, 0x43, 0x44], payload.slice(0, -1));

  expect(() => loads(cut)).toThrow(/^truncated stream/);
});

test('a HashMap whose block data is too short to hold its size is refused', () => {
  const whole = twoStrings();
  const found = positions(whole, [TC_BLOCKDATA, 0x08]);
  expect(found).toHaveLength(1);

  // Rewrite the block's length byte to 4, so the payload ends before the size field, and drop the bytes it no longer
  // owns.
  const at = (found[0] ?? 0) + 1;
  const short = Uint8Array.from([...whole.subarray(0, at), 0x04, ...whole.subarray(at + 1 + 4)]);
  expect(() => loads(short)).toThrow(/^HashMap block data too short/);
});

/**
 * A back-reference is an index into the handle table, and the table is built as the stream is read — so a file whose
 * references have been shifted or scrambled cites something that is not there, or is there and is the wrong kind of
 * thing. All three are refused rather than read as whatever happens to sit at that index.
 */
test('a handle reference that cites nothing is refused', () => {
  // Handle 3 is the "Melbourne Zoo" the second entry cites, and the only reference in the stream — asserted rather than
  // counted off the claims, since the claims run classdesc, map, key, string and are easy to be one out on.
  const bytes = splice(twoStrings(), [TC_REFERENCE, ...handle(3)], [TC_REFERENCE, ...handle(99)]);
  expect(() => loads(bytes)).toThrow(/^bad handle reference 99/);
});

test('a value reference citing a class descriptor is refused', () => {
  // Handle 0 is java.util.HashMap's descriptor, claimed before the map itself — so this is a reference of the right
  // shape pointing at the wrong kind of entry, which is what a shifted handle looks like.
  const bytes = splice(twoStrings(), [TC_REFERENCE, ...handle(3)], [TC_REFERENCE, ...handle(0)]);
  expect(() => loads(bytes)).toThrow(/^handle 0 is a class descriptor, not a value/);
});

test('a class reference citing a value is refused', () => {
  // The writer cites a class descriptor it has already written, so a second box of one type carries one. Pointing it at
  // the string's handle is the mirror of the case above.
  const twoBoxes = dumps(
    new Map<JavaValue, JavaValue>([
      ['a', box('I', 1)],
      ['b', box('I', 2)],
    ]),
  );

  // Handle 3 is java.lang.Integer's descriptor here, where in the two-string stream the same number was a string —
  // which is the whole reason a reference carries no kind and the reader has to check.
  expect(positions(twoBoxes, [TC_REFERENCE, ...handle(3)])).toHaveLength(1);
  expect(() => loads(splice(twoBoxes, [TC_REFERENCE, ...handle(3)], [TC_REFERENCE, ...handle(2)]))).toThrow(
    /^handle 2 is a value, not a class descriptor/,
  );
});

/**
 * Where a class descriptor belongs, nothing else will do — including a string, which is otherwise a valid content item.
 */
test('a tag where a class descriptor belongs is refused', () => {
  const bytes = twoStrings();
  const at = positions(bytes, [TC_CLASSDESC, ...named('java.util.HashMap')]);

  expect(at).toHaveLength(1);
  expect(() => loads(splice(bytes, [TC_CLASSDESC, ...named('java.util.HashMap')], [TC_STRING]))).toThrow(
    /^expected classdesc, got 0x74 at 5/,
  );
});

/**
 * A null class descriptor is well-formed in the stream and meaningless for an object, so it is its own message rather
 * than a `null` travelling into the field walk.
 */
test('an object with no class descriptor is refused', () => {
  const bytes = splice(twoStrings(), [TC_CLASSDESC, ...named('java.util.HashMap')], [TC_NULL]);
  expect(() => loads(bytes)).toThrow(/^object with no class descriptor/);
});

/**
 * A tag this codec has no reader for is refused rather than skipped, since skipping it would desynchronise the rest.
 */
test('a tag nothing reads is refused', () => {
  // 0x7b is TC_EXCEPTION, a real tag in Java's own set and one nothing here handles.
  const bytes = splice(twoStrings(), [TC_STRING, ...named('first')], [0x7b]);
  expect(() => loads(bytes)).toThrow(/^unsupported tag 0x7b/);
});

/**
 * A boxed primitive is recognised by its class name and read through the one field that name implies, so a descriptor
 * naming the field anything else is a box with nothing to unbox. One byte reaches it, which is why the guard reads the
 * slot rather than testing for the field and then indexing it.
 */
test('a box whose value field is named something else is refused', () => {
  const bytes = dumps(box('I', 7));
  const renamed = splice(bytes, named('value'), named('valve'));

  expect(renamed).toHaveLength(bytes.length);
  expect(() => loads(renamed)).toThrow(/^java\.lang\.Integer declares no primitive value field/);
});

/** A class neither boxed nor HashMap is refused by name, which is the whole of what this codec claims to read. */
test('a class this codec does not know is refused', () => {
  const bytes = dumps(box('I', 7));
  expect(() => loads(splice(bytes, named('java.lang.Integer'), named('java.lang.Intege_')))).toThrow(
    /^unsupported class java\.lang\.Intege_/,
  );
});

/**
 * A class flagged as having written custom data gets its payload read by a handler named for the class — so a stream
 * whose HashMap has been renamed reaches the handler lookup rather than the class check below it, there being no way to
 * read past a `writeObject` payload without knowing its shape.
 */
test('custom data for a class with no handler is refused', () => {
  const bytes = twoStrings();
  expect(() => loads(splice(bytes, named('java.util.HashMap'), named('java.util.HashMip')))).toThrow(
    /^no custom-data handler for java\.util\.HashMip/,
  );
});

test('a HashMap payload that does not start with block data is refused', () => {
  const bytes = twoStrings();
  expect(() => loads(splice(bytes, [TC_BLOCKDATA, 0x08], [TC_NULL, 0x08]))).toThrow(/^expected HashMap block data/);
});

test('a HashMap payload that does not end where it says is refused', () => {
  const whole = twoStrings();

  // The last byte is the map's own TC_ENDBLOCKDATA, so swapping it for anything else is the case — and it is a swap
  // rather than a truncation, which the stream-level bounds check would catch first.
  expect(whole.at(-1)).toBe(TC_ENDBLOCKDATA);
  const patched = Uint8Array.from([...whole.subarray(0, whole.length - 1), TC_NULL]);

  expect(() => loads(patched)).toThrow(/^expected TC_ENDBLOCKDATA after HashMap/);
});

/**
 * A classAnnotation is whatever a `writeObject` on the class put there and this reader discards it — but discarding it
 * means reading past it, and the three shapes it can take are each sized differently. The writer only ever emits an
 * empty one, so these splice the other three into a stream that is otherwise untouched: a short block, a long block and
 * a bare content item. All three have to leave the stream readable, which the round trip is what says.
 */
test.for([
  { shape: 'a short block', inserted: [TC_BLOCKDATA, 0x02, 0xaa, 0xbb] },
  { shape: 'a long block', inserted: [TC_BLOCKDATALONG, 0x00, 0x00, 0x00, 0x02, 0xaa, 0xbb] },

  // TC_NULL rather than a string, because a string claims a handle the writer did not and would shift every later one.
  { shape: 'a bare content item', inserted: [TC_NULL] },

  { shape: 'all three at once', inserted: [TC_BLOCKDATA, 0x01, 0xaa, TC_NULL, TC_BLOCKDATALONG, 0, 0, 0, 1, 0xbb] },
])('a classAnnotation holding $shape is read past', ({ inserted }) => {
  const bytes = dumps(box('Z', true));
  const annotation = [...named('value'), TC_ENDBLOCKDATA];
  const patched = splice(bytes, annotation, [...named('value'), ...inserted, TC_ENDBLOCKDATA]);

  expect(patched.length).toBe(bytes.length + inserted.length);
  expect(loads(patched)).toEqual(box('Z', true));
});

/**
 * Every width a declared field can have, reached by rewriting an Integer's declaration and its payload together, so
 * each case says the reader advanced by exactly the bytes that width takes — which `loads`'s trailing-bytes check
 * proves. `C` and `L` read something a box cannot hold, so each lands on the value-field guard rather than coming back
 * as a box, which is the right end for both: a `java.lang.Integer` whose `value` is a string is a stream no JVM wrote.
 */
test.for([
  { width: 'a double', tcode: 'D', payload: [0x3f, 0xe0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00], reads: box('I', 0.5) },
  { width: 'a byte', tcode: 'B', payload: [0x2a], reads: box('I', 42) },
  { width: 'a short', tcode: 'S', payload: [0xff, 0xfe], reads: box('I', -2) },
  { width: 'a signed short', tcode: 'S', payload: [0x7f, 0xff], reads: box('I', 32767) },
])('a value field declared as $width is read at that width', ({ tcode, payload, reads }) => {
  const bytes = dumps(box('I', 0x41424344));
  const declared = splice(bytes, [ascii('I')[0] ?? 0, ...named('value')], [ascii(tcode)[0] ?? 0, ...named('value')]);

  expect(loads(splice(declared, [0x41, 0x42, 0x43, 0x44], payload))).toEqual(reads);
});

test('a value field declared as a character is read and then refused as a value', () => {
  const bytes = dumps(box('I', 0x41424344));
  const declared = splice(bytes, [ascii('I')[0] ?? 0, ...named('value')], [ascii('C')[0] ?? 0, ...named('value')]);

  expect(() => loads(splice(declared, [0x41, 0x42, 0x43, 0x44], [0x00, 0x41]))).toThrow(
    /^java\.lang\.Integer declares no primitive value field/,
  );
});

/**
 * An object-reference field carries its type string in the declaration and its value as a content item, which is two
 * reads where a primitive is one. A null value is the cheapest content item there is, and lands on the value guard for
 * the reason the character does.
 */
test('a value field declared as an object reference reads its type string and its value', () => {
  const bytes = dumps(box('I', 0x41424344));
  const declared = splice(
    bytes,
    [ascii('I')[0] ?? 0, ...named('value')],
    [ascii('L')[0] ?? 0, ...named('value'), TC_STRING, ...named('Ljava/lang/Object;')],
  );

  expect(() => loads(splice(declared, [0x41, 0x42, 0x43, 0x44], [TC_NULL]))).toThrow(
    /^java\.lang\.Integer declares no primitive value field/,
  );
});

/**
 * A width nothing reads is refused at the declaration, rather than read at some other width and silently misaligned.
 */
test('a field declared at a width nothing reads is refused', () => {
  const bytes = dumps(box('I', 7));
  const declared = splice(bytes, [ascii('I')[0] ?? 0, ...named('value')], [ascii('Q')[0] ?? 0, ...named('value')]);

  expect(() => loads(declared)).toThrow(/^unsupported field type 'Q'/);
});

/**
 * What `dumps` refuses outright. A number is the near miss worth naming: a map value that should have been boxed and
 * was not reaches the writer with no width to write it at, and would otherwise fall through to no bytes at all.
 *
 * The writer's own `no encoding for boxed field type` default is unreachable rather than uncovered — every code `BOX`
 * carries has a case, and `box` refuses any other before a `Box` can exist — and earns its place by being what fails
 * if a fifth entry is added to `BOX` and not encoded.
 */
test('a value that is none of the four things a stream can hold is refused', () => {
  // @ts-expect-error -- a bare number is no `JavaValue`, which is the compile-time half of this check
  expect(() => dumps(42)).toThrow(/^cannot serialize number/);

  // @ts-expect-error -- nor is an array, which is the shape a caller reaching for a Java array would try
  expect(() => dumps([1, 2])).toThrow(/^cannot serialize object/);
});
