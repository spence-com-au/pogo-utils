/**
 * A minimal codec for Java's Object Serialization Stream Protocol — the slice PGSData.dat uses — ported from pgsedit.
 *
 * A value here is one of four things and nothing else — `null`, a string, a boxed primitive or a `Map` — so the tags
 * `content` reads and the shapes `value` writes cover the same ground from either end. Block data is not among them,
 * appearing only in the annotations `skipAnnotation` discards.
 *
 * The whole stream is re-emitted from scratch rather than patched in place: back-references are positional handles, so
 * changing one value shifts every handle after it. See the pgsedit README for the wire format this mirrors.
 */
export const JavaSer = (() => {
  // ObjectStreamConstants.
  const STREAM_MAGIC = 0xaced,
    STREAM_VERSION = 5;
  const TC_NULL = 0x70,
    TC_REFERENCE = 0x71,
    TC_CLASSDESC = 0x72,
    TC_OBJECT = 0x73,
    TC_STRING = 0x74,
    TC_ENDBLOCKDATA = 0x78,
    TC_BLOCKDATA = 0x77,
    TC_BLOCKDATALONG = 0x7a,
    TC_LONGSTRING = 0x7c;
  const BASE_HANDLE = 0x7e0000;
  const SC_WRITE_METHOD = 0x01,
    SC_SERIALIZABLE = 0x02;

  /**
   * The four things a value is, which is what makes the tags `content` reads and the shapes `value` writes cover the
   * same ground from either end.
   */
  type JavaValue = null | string | Box | JavaMap;
  type JavaMap = Map<JavaValue, JavaValue>;

  /**
   * A JVM field-type code this codec boxes, and the widths their values take. The pairing is the codec's own — I and F
   * carry a Number, J a BigInt, Z a boolean — and nothing at the type level ties a `Box`'s two fields together, so it
   * is checked where the bytes are written.
   */
  type BoxCode = 'I' | 'J' | 'F' | 'Z';
  type BoxValue = number | bigint | boolean;

  /**
   * A class descriptor as the stream carries it. `fields` is a `[typeCode, name]` pair per declared field, in stream
   * order, and `super` walks up the chain to the `null` that ends it.
   */
  type ClassDesc = { name: string; uid: bigint; flags: number; fields: [string, string][]; super: ClassDesc | null };

  /**
   * One back-reference table entry, tagged so a handle citing the wrong kind is caught at the citation.
   */
  type Handle = { kind: 'value'; value: JavaValue } | { kind: 'class'; desc: ClassDesc };

  /**
   * What one declared field holds: anything `content` answers, or any primitive `readPrimitive` does.
   */
  type FieldValue = JavaValue | number | bigint | boolean;

  /**
   * Boxed primitives, keyed by JVM field-type code. The value carried is a Number for I/F, a BigInt for J (a 64-bit
   * long won't fit a JS number and must round-trip exactly — PGSharp hides doubles inside longs), and a boolean for Z.
   */
  const BOX = {
    I: { cls: 'java.lang.Integer', uid: 0x12e2a0a4f7818738n },
    J: { cls: 'java.lang.Long', uid: 0x3b8be490cc8f23dfn },
    F: { cls: 'java.lang.Float', uid: 0xdaedc9a2db3cf0ecn },
    Z: { cls: 'java.lang.Boolean', uid: 0xcd207280d59cfaeen },
  };

  /**
   * The same table the other way round, and an index signature rather than the four keys, because what indexes it is a
   * class name read out of the stream.
   */
  const BOX_BY_CLASS: Record<string, BoxCode> = {
    'java.lang.Integer': 'I',
    'java.lang.Long': 'J',
    'java.lang.Float': 'F',
    'java.lang.Boolean': 'Z',
  };
  const NUMBER = { name: 'java.lang.Number', uid: 0x86ac951d0b94e08bn };
  const HASHMAP_UID = 0x0507dac1c31660d1n;

  const err = (m: string) => new Error(m);

  /**
   * A boxed primitive, the one value shape that is neither a string nor a map. A class rather than a `{box, value}`
   * literal so reader and writer share one representation and `instanceof` separates it from a `Map`, where `'box' in
   * v` throws on the very primitives `dumps` exists to reject. The field type is checked here so an unsupported one
   * fails at the call that named it.
   */
  class Box {
    code: BoxCode;
    value: BoxValue;

    constructor(code: BoxCode, value: BoxValue) {
      if (!(code in BOX)) {
        throw err(`no boxed Java primitive for field type '${code}'`);
      }

      this.code = code;
      this.value = value;
    }
  }

  /**
   * Java's "modified UTF-8": U+0000 is C0 80 and non-BMP characters are written as their two UTF-16 surrogates (3 bytes
   * each), so we iterate UTF-16 code units rather than code points.
   */
  function encodeMutf8(s: string) {
    const out = [];

    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);

      if (c === 0) {
        out.push(0xc0, 0x80);
      } else if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }

    return out;
  }

  function decodeMutf8(bytes: Uint8Array) {
    let s = '',
      i = 0;

    /**
     * One byte of the sequence, or the truncation the two length tests used to make separately: reading past the end
     * answers `undefined`, which is the same thing a bounds check was asking about one lookup earlier.
     */
    const byte = (at: number) => {
      const b = bytes[at];

      if (b === undefined) {
        throw err('truncated modified UTF-8 sequence');
      }

      return b;
    };

    while (i < bytes.length) {
      const c = byte(i);

      if (c < 0x80) {
        s += String.fromCharCode(c);
        i += 1;
      } else if ((c & 0xe0) === 0xc0) {
        s += String.fromCharCode(((c & 0x1f) << 6) | (byte(i + 1) & 0x3f));
        i += 2;
      } else if ((c & 0xf0) === 0xe0) {
        s += String.fromCharCode(((c & 0x0f) << 12) | ((byte(i + 1) & 0x3f) << 6) | (byte(i + 2) & 0x3f));
        i += 3;
      } else {
        throw err(`invalid modified UTF-8 byte 0x${c.toString(16)}`);
      }
    }

    return s;
  }

  class Reader {
    b: Uint8Array;
    dv: DataView;
    p = 0;

    /**
     * The back-reference table. Handles are positional and both kinds share one sequence, so a classdesc reference and
     * a value reference read the same four bytes — only the caller knows which the stream should have put there, and
     * tagging the entries is what lets it say so.
     */
    handles: Handle[] = [];

    constructor(bytes: Uint8Array) {
      this.b = bytes;
      this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }

    /** Refuses a fixed-width read that would run past the end, which `DataView` reports as a bare `RangeError`. */
    need(n: number) {
      if (this.p + n > this.b.length) {
        throw err('truncated stream');
      }
    }
    u1() {
      const v = this.b[this.p];

      if (v === undefined) {
        throw err('truncated stream');
      }

      this.p += 1;
      return v;
    }
    i2() {
      this.need(2);

      const v = this.dv.getInt16(this.p);
      this.p += 2;
      return v;
    }
    u2() {
      this.need(2);

      const v = this.dv.getUint16(this.p);
      this.p += 2;
      return v;
    }
    i4() {
      this.need(4);

      const v = this.dv.getInt32(this.p);
      this.p += 4;
      return v;
    }
    i8() {
      this.need(8);

      const v = this.dv.getBigInt64(this.p);
      this.p += 8;
      return v;
    }
    f4() {
      this.need(4);

      const v = this.dv.getFloat32(this.p);
      this.p += 4;
      return v;
    }
    f8() {
      this.need(8);

      const v = this.dv.getFloat64(this.p);
      this.p += 8;
      return v;
    }
    raw(n: number) {
      const v = this.b.subarray(this.p, this.p + n);

      if (v.length !== n) {
        throw err('truncated stream');
      }

      this.p += n;
      return v;
    }
    peek() {
      return this.b[this.p];
    }
    newValueHandle(value: JavaValue) {
      this.handles.push({ kind: 'value', value });
      return value;
    }
    newClassHandle(desc: ClassDesc) {
      this.handles.push({ kind: 'class', desc });
      return desc;
    }

    /**
     * The JVM assigns an object's handle before its fields are read, so a self-referential object can cite itself;
     * reserve the slot, back-patch it.
     */
    claimValueHandle() {
      this.handles.push({ kind: 'value', value: null });
      return this.handles.length - 1;
    }

    /**
     */
    resolveValueHandle(slot: number, value: JavaValue) {
      this.handles[slot] = { kind: 'value', value };
      return value;
    }

    /**
     * The entry a back-reference cites, with its index for the message. Reading the slot is the whole bounds check: a
     * handle below the table or past its end answers `undefined` either way, where a range test and then an index are
     * two lookups with nothing joining them.
     */
    refHandle() {
      const h = this.i4() - BASE_HANDLE;
      const entry = this.handles[h];

      if (entry === undefined) {
        throw err(`bad handle reference ${h}`);
      }

      return { h, entry };
    }

    refValue() {
      const { h, entry } = this.refHandle();

      if (entry.kind !== 'value') {
        throw err(`handle ${h} is a class descriptor, not a value`);
      }

      return entry.value;
    }
    refClass() {
      const { h, entry } = this.refHandle();

      if (entry.kind !== 'class') {
        throw err(`handle ${h} is a value, not a class descriptor`);
      }

      return entry.desc;
    }
    utf() {
      return decodeMutf8(this.raw(this.u2()));
    }
    longUtf() {
      return decodeMutf8(this.raw(Number(this.i8())));
    }

    classDesc() {
      const tag = this.u1();

      if (tag === TC_NULL) {
        return null;
      }

      if (tag === TC_REFERENCE) {
        return this.refClass();
      }

      if (tag !== TC_CLASSDESC) {
        throw err(`expected classdesc, got 0x${tag.toString(16)} at ${this.p - 1}`);
      }

      const name = this.utf();
      const uid = this.i8();
      const flags = this.u1();
      const desc = this.newClassHandle({ name, uid, flags, fields: [], super: null });
      const nfields = this.u2();

      for (let i = 0; i < nfields; i++) {
        const tcode = String.fromCharCode(this.u1());
        const fname = this.utf();

        if (tcode === 'L' || tcode === '[') {
          this.content(); // the field's type string, unused
        }

        desc.fields.push([tcode, fname]);
      }

      this.skipAnnotation();
      desc.super = this.classDesc();
      return desc;
    }

    /**
     * A class or object annotation, discarded. This is the only place block data appears, so it is consumed here rather
     * than returned from `content`, which answers what a field or a map entry can hold — and a byte array is not one of
     * those.
     */
    skipAnnotation() {
      for (;;) {
        const tag = this.peek();

        if (tag === TC_ENDBLOCKDATA) {
          this.p += 1;
          return;
        }

        if (tag === TC_BLOCKDATA) {
          this.p += 1;
          this.raw(this.u1());
        } else if (tag === TC_BLOCKDATALONG) {
          this.p += 1;
          this.raw(this.i4());
        } else {
          this.content();
        }
      }
    }

    readPrimitive(tcode: string) {
      switch (tcode) {
        case 'I':
          return this.i4();
        case 'J':
          return this.i8();
        case 'F':
          return this.f4();
        case 'D':
          return this.f8();
        case 'Z':
          return this.u1() !== 0;
        case 'B':
          return this.u1();

        case 'S':
          return this.i2();
        case 'C':
          return String.fromCharCode(this.u2());

        default:
          throw err(`unsupported field type '${tcode}'`);
      }
    }
    content() {
      const tag = this.u1();

      if (tag === TC_NULL) {
        return null;
      }

      if (tag === TC_REFERENCE) {
        return this.refValue();
      }

      if (tag === TC_STRING) {
        return this.newValueHandle(this.utf());
      }

      if (tag === TC_LONGSTRING) {
        return this.newValueHandle(this.longUtf());
      }

      if (tag === TC_OBJECT) {
        return this.object();
      }

      throw err(`unsupported tag 0x${tag.toString(16)} at offset ${this.p - 1}`);
    }

    /**
     * One class's declared fields. Only HashMap's writeObject payload is needed downstream, so a value is read to
     * advance the stream rather than because anything looks at it — bar a box's `value`, which `object` takes from the
     * most-derived class in the chain.
     */
    readFields(fields: [string, string][]) {
      const values: Record<string, FieldValue> = {};

      for (const [tcode, fname] of fields) {
        values[fname] = tcode === 'L' || tcode === '[' ? this.content() : this.readPrimitive(tcode);
      }

      return values;
    }

    object() {
      const desc = this.classDesc();

      if (desc === null) {
        throw err(`object with no class descriptor at offset ${this.p - 1}`);
      }

      const slot = this.claimValueHandle();

      // Seeded from `desc.super` rather than from `desc`, because a loop variable takes its type from its initializer:
      // starting at the descriptor makes `d` a `ClassDesc`, which the walk up to the `null` above `java.lang.Object`
      // then cannot assign to.
      const chain = [desc];

      for (let d = desc.super; d !== null; d = d.super) {
        chain.push(d);
      }

      chain.reverse(); // superclass fields come first

      /*
       * Both belong to the instance being read rather than to the descriptor, which every instance of the class shares
       * through its handle. Holding them there was correct only by adjacency, which the shape never said.
       */
      let own: Record<string, FieldValue> = {};

      let custom: JavaMap | null = null;

      for (const d of chain) {
        const values = this.readFields(d.fields);

        if (d === desc) {
          own = values;
        }

        if (d.flags & SC_WRITE_METHOD) {
          custom = this.customData(d.name);
        }
      }

      const name = desc.name;
      const code = BOX_BY_CLASS[name];

      if (code !== undefined) {
        // One lookup rather than an `in` test and then an index, which also covers the field being declared at a width
        // a box cannot hold: a descriptor naming `value` as an object reference reads back a string or a map, and
        // `undefined` for no such field at all fails the same check.
        const value = own.value;

        if (typeof value !== 'number' && typeof value !== 'bigint' && typeof value !== 'boolean') {
          throw err(`${name} declares no primitive value field`);
        }

        return this.resolveValueHandle(slot, new Box(code, value));
      }

      if (name === 'java.util.HashMap') {
        return this.resolveValueHandle(slot, custom);
      }

      throw err(`unsupported class ${name}`);
    }
    customData(className: string) {
      if (className !== 'java.util.HashMap') {
        throw err(`no custom-data handler for ${className}`);
      }

      if (this.u1() !== TC_BLOCKDATA) {
        throw err('expected HashMap block data');
      }

      const payload = this.raw(this.u1());

      if (payload.length < 8) {
        throw err('HashMap block data too short');
      }

      const pdv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const size = pdv.getInt32(4); // [capacity, size]; capacity is recomputed on write
      const m: JavaMap = new Map();

      for (let i = 0; i < size; i++) {
        const k = this.content();
        m.set(k, this.content());
      }

      if (this.u1() !== TC_ENDBLOCKDATA) {
        throw err('expected TC_ENDBLOCKDATA after HashMap');
      }

      return m;
    }
  }

  function loads(bytes: Uint8Array) {
    const r = new Reader(bytes);

    if (r.u2() !== STREAM_MAGIC || r.u2() !== STREAM_VERSION) {
      throw err('not a Java serialization stream (bad magic/version)');
    }

    const root = r.content();

    if (r.p !== bytes.length) {
      throw err(`${bytes.length - r.p} trailing bytes after root object`);
    }

    return root;
  }

  class Writer {
    out: number[] = [];
    strHandles = new Map<string, number>(); // value-keyed; a repeat becomes a back-reference
    boxHandles = new Map<Box, number>(); // identity-keyed
    classHandles = new Map<string, number>(); // name-keyed
    next = 0;

    claim() {
      return this.next++;
    }
    push(bytes: Iterable<number>) {
      for (const b of bytes) {
        this.out.push(b);
      }
    }
    u1(v: number) {
      this.out.push(v & 0xff);
    }
    u2(v: number) {
      this.out.push((v >> 8) & 0xff, v & 0xff);
    }
    i4(v: number) {
      this.out.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
    }
    i8(v: bigint) {
      let x = BigInt.asUintN(64, v);

      const bytes: number[] = new Array(8);

      for (let i = 7; i >= 0; i--) {
        bytes[i] = Number(x & 0xffn);
        x >>= 8n;
      }

      this.push(bytes);
    }
    f4(v: number) {
      const b = new Uint8Array(4);
      new DataView(b.buffer).setFloat32(0, v, false);
      this.push(b);
    }
    utf(s: string) {
      const b = encodeMutf8(s);

      if (b.length > 0xffff) {
        throw err('string too long for TC_STRING');
      }

      this.u2(b.length);
      this.push(b);
    }
    ref(h: number) {
      this.u1(TC_REFERENCE);
      this.i4(BASE_HANDLE + h);
    }
    string(s: string) {
      const h = this.strHandles.get(s);

      if (h !== undefined) {
        this.ref(h);
        return;
      }

      const b = encodeMutf8(s);

      if (b.length <= 0xffff) {
        this.u1(TC_STRING);
        this.u2(b.length);
      } else {
        this.u1(TC_LONGSTRING);
        this.i8(BigInt(b.length));
      }

      this.push(b);
      this.strHandles.set(s, this.claim());
    }

    /**
     * One superclass parameter rather than a name and a uid, because the two are meaningless apart and nothing at the
     * type level could say that the second is present whenever the first is. `NUMBER` is already exactly this shape.
     */
    classDesc(
      name: string,
      uid: bigint,
      flags: number,
      fields: [string, string][],
      superclass?: { name: string; uid: bigint },
    ) {
      const h = this.classHandles.get(name);

      if (h !== undefined) {
        this.ref(h);
        return;
      }

      this.u1(TC_CLASSDESC);
      this.utf(name);
      this.i8(uid);
      this.u1(flags);
      this.u2(fields.length);

      for (const [tc, fn] of fields) {
        this.u1(tc.charCodeAt(0));
        this.utf(fn);
      }

      this.u1(TC_ENDBLOCKDATA); // empty classAnnotation
      this.classHandles.set(name, this.claim());

      if (superclass === undefined) {
        this.u1(TC_NULL);
      } else {
        this.classDesc(superclass.name, superclass.uid, SC_SERIALIZABLE, []);
      }
    }

    box(b: Box) {
      const info = BOX[b.code];
      this.u1(TC_OBJECT);

      if (b.code === 'Z') {
        this.classDesc(info.cls, info.uid, SC_SERIALIZABLE, [['Z', 'value']]);
      } else {
        this.classDesc(info.cls, info.uid, SC_SERIALIZABLE, [[b.code, 'value']], NUMBER);
      }

      this.boxHandles.set(b, this.claim());

      /**
       * The value at the width `I` and `F` both name. A `Box` holds its code and its value in two fields, so nothing
       * at the type level pairs them the way `BOX` documents — and a mismatch was silent rather than loud, since
       * `box('I', 'x')` wrote four zero bytes for `'x' >>> 24`.
       */
      const asNumber = () => {
        if (typeof b.value !== 'number') {
          throw err(`boxed ${info.cls} needs a Number value, got ${typeof b.value}`);
        }

        return b.value;
      };

      // A `switch` with a default rather than an `if` chain, so adding a `BOX` entry and forgetting to encode it fails
      // here instead of writing a class descriptor with no value after it.
      switch (b.code) {
        case 'Z':
          this.u1(b.value ? 1 : 0);
          break;

        case 'I':
          this.i4(asNumber());
          break;

        case 'F':
          this.f4(asNumber());
          break;

        case 'J':
          if (typeof b.value !== 'bigint') {
            throw err(`boxed ${info.cls} needs a BigInt value, got ${typeof b.value}`);
          }

          this.i8(b.value);
          break;

        default:
          throw err(`no encoding for boxed field type '${b.code}'`);
      }
    }
    value(v: JavaValue | undefined) {
      if (v === null || v === undefined) {
        this.u1(TC_NULL);
      } else if (typeof v === 'string') {
        this.string(v);
      } else if (v instanceof Box) {
        const h = this.boxHandles.get(v);

        if (h !== undefined) {
          this.ref(h);
        } else {
          this.box(v);
        }
      } else if (v instanceof Map) {
        this.hashmap(v);
      } else {
        throw err(`cannot serialize ${typeof v}`);
      }
    }
    hashmap(m: JavaMap) {
      this.u1(TC_OBJECT);
      this.classDesc('java.util.HashMap', HASHMAP_UID, SC_WRITE_METHOD | SC_SERIALIZABLE, [
        ['F', 'loadFactor'],
        ['I', 'threshold'],
      ]);
      this.claim(); // the map's own handle
      const loadFactor = 0.75;
      const capacity = tableSizeFor(m.size, loadFactor);
      this.f4(loadFactor);
      this.i4(Math.trunc(capacity * loadFactor));
      this.u1(TC_BLOCKDATA);
      this.u1(8);
      this.i4(capacity);
      this.i4(m.size);

      for (const [k, val] of m) {
        this.value(k);
        this.value(val);
      }

      this.u1(TC_ENDBLOCKDATA);
    }
  }

  /**
   * Mirror HashMap's power-of-two capacity growth for a given entry count.
   */
  function tableSizeFor(size: number, loadFactor: number) {
    let capacity = 16;

    while (size > capacity * loadFactor) {
      capacity <<= 1;
    }

    return capacity;
  }

  function dumps(root: JavaValue) {
    const w = new Writer();
    w.u2(STREAM_MAGIC);
    w.u2(STREAM_VERSION);
    w.value(root);
    return Uint8Array.from(w.out);
  }

  return {
    loads,
    dumps,
    box: (code: BoxCode, value: BoxValue) => new Box(code, value),
  };
})();
