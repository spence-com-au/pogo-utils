/**
 * One species, or one of its forms — a dex number wearing a name. Naming a form or a region asks for one the species
 * actually has and hands back the Pokemon that form is, so a filter can say which form it means and still write the
 * one number PGSharp stores: `toJSON` leaves `JSON.stringify` to emit the dex number and nothing else.
 *
 * A species is built up a link at a time, and two things travel down the chain. The **cursor** is what a marker
 * applies to: every `is…`/`does…` marker lands on whatever was declared last, which is the species until a form or
 * region is named. These are properties of the form rather than the species, a species being able to have a shiny
 * where its regional variant does not, and undeclared reads as eligible. A Legendary, Mythical, Baby or Ultra Beast is
 * one the wild never turns up, so those four stop it spawning too — Meltan the lone Mythical that does, saying
 * `doesSpawn` after to put it back. A Regional still spawns, only somewhere particular, so it leaves spawning alone.
 *
 * The **target** is what a new form or region hangs off. `addForm`, `addForms`, `addRegion` and `addRegions` declare
 * peers at the current target and leave it there, so listing several is listing siblings; `withForm` and `withRegion`
 * descend into one, so what follows nests beneath.
 *
 * ```js
 * new Pokemon(128).withRegion(PALDEA).doesNotSpawn().addForms('COMBAT_BREED', 'BLAZE_BREED', 'AQUA_BREED');
 * ```
 */
export default class Pokemon {
  #dex: number;
  #name: string;

  /** The region this variant belongs to — its adjective (`PALDEA`), or null for a base species and a plain form. */
  #region: string | null = null;

  #forms = new Map<string, Pokemon>();

  #regions = new Map<string, Pokemon>();

  #released = true;
  #shinyEligible = true;
  #spawns = true;

  #baby = false;
  #legendary = false;
  #mythical = false;
  #regional = false;
  #ultraBeast = false;

  #frozen = false;

  /**
   * The cursor a marker lands on.
   *
   * `Pokemon`, rather than the `this` type inference reaches for: every value after the constructor's is something
   * `#variant` built with a bare `new Pokemon`, so a subclass would find base instances in here. The builders' own
   * `return this` stays inferred, because there it is true.
   */
  #declared: Pokemon[];

  /** The target a new form or region hangs off. */
  #target: Pokemon;

  constructor(dex: number) {
    this.#dex = dex;
    this.#name = `#${dex}`;
    this.#declared = [this];
    this.#target = this;
  }

  /** One form, as `addForms` with a single name. The callback is handed that form and the target stays put. */
  addForm(name: string, configure?: (form: Pokemon) => void) {
    return this.#declare(this.#target.#createForm(name), configure);
  }

  /**
   * The forms this species comes in as peers of one another, spelled as the games spell them. The target does not
   * move, so a later `addForms` adds more siblings rather than nesting under the first.
   */
  addForms(...names: string[]) {
    this.#declared = names.map((name) => this.#target.#createForm(name));
    return this;
  }

  /** One region, as `addRegions` with a single region. The callback is handed that variant and the target stays put. */
  addRegion(region: string, configure?: (variant: Pokemon) => void) {
    return this.#declare(this.#target.#createRegion(region), configure);
  }

  /** The regions this species has a variant in, as peers of one another. To descend into one, use `withRegion`. */
  addRegions(...regions: string[]) {
    this.#declared = regions.map((region) => this.#target.#createRegion(region));
    return this;
  }

  /** One form to descend into, so what follows lands on it rather than the species — for a form carrying its own. */
  withForm(name: string, configure?: (form: Pokemon) => void) {
    const variant = this.#target.#createForm(name);

    this.#declare(variant, configure);
    this.#target = variant;
    return this;
  }

  /**
   * One region to descend into, so the forms that follow hang beneath it — the Paldean breeds under Paldean Tauros.
   *
   * ```js
   * new Pokemon(128).withRegion(PALDEA).doesNotSpawn().addForms('COMBAT_BREED', 'BLAZE_BREED', 'AQUA_BREED');
   * ```
   */
  withRegion(region: string, configure?: (variant: Pokemon) => void) {
    const variant = this.#target.#createRegion(region);

    this.#declare(variant, configure);
    this.#target = variant;
    return this;
  }

  isReleased() {
    return this.#mark((variant) => {
      variant.#released = true;
    });
  }

  isNotReleased() {
    return this.#mark((variant) => {
      variant.#released = false;
    });
  }

  isShinyEligible() {
    return this.#mark((variant) => {
      variant.#shinyEligible = true;
    });
  }

  isNotShinyEligible() {
    return this.#mark((variant) => {
      variant.#shinyEligible = false;
    });
  }

  doesSpawn() {
    return this.#mark((variant) => {
      variant.#spawns = true;
    });
  }

  doesNotSpawn() {
    return this.#mark((variant) => {
      variant.#spawns = false;
    });
  }

  /** Hatched from an egg and never met in the wild, so it stops spawning too. */
  isBaby() {
    return this.#mark((variant) => {
      variant.#baby = true;
      variant.#spawns = false;
    });
  }

  /** The wild never turns one up, so it stops spawning too. */
  isLegendary() {
    return this.#mark((variant) => {
      variant.#legendary = true;
      variant.#spawns = false;
    });
  }

  /** The same, Meltan being the one that spawns anyway and saying `doesSpawn` after to put it back. */
  isMythical() {
    return this.#mark((variant) => {
      variant.#mythical = true;
      variant.#spawns = false;
    });
  }

  /** One the wild turns up only in its own part of the world. It still spawns, so this leaves `#spawns` alone. */
  isRegional() {
    return this.#mark((variant) => {
      variant.#regional = true;
    });
  }

  /** For a form that turns up anywhere, so a Regional species can hand one back to the wild at large. */
  isNotRegional() {
    return this.#mark((variant) => {
      variant.#regional = false;
    });
  }

  /** The wild never turns one up, so it stops spawning too. */
  isUltraBeast() {
    return this.#mark((variant) => {
      variant.#ultraBeast = true;
      variant.#spawns = false;
    });
  }

  /** Names this species for the errors below, from the constant it is bound to, and renames its forms with it. */
  as(name: string) {
    this.#assertMutable();
    this.#name = name;

    for (const [form, variant] of this.#forms) {
      variant.as(`${name} (${form})`);
    }

    for (const [region, variant] of this.#regions) {
      variant.as(`${region} ${name}`);
    }

    return this;
  }

  /**
   * Seal this species and its forms and regions once the dex is declared, so a builder called afterwards throws rather
   * than quietly flipping state every consumer of `POKEMON` sees. Read-only lookups are unaffected.
   */
  freeze() {
    this.#frozen = true;

    for (const variant of this.#forms.values()) {
      variant.freeze();
    }

    for (const variant of this.#regions.values()) {
      variant.freeze();
    }

    return this;
  }

  /**
   * One of this species' forms, a name it does not have stopping here rather than reaching the backup as a null.
   *
   * One `get` and a check on what came back rather than a `has` then a `get`: nothing at the type level says the two
   * asked the same key, so `get` still answers `Pokemon | undefined` however the `has` went.
   */
  form(name: string): Pokemon {
    const variant = this.#forms.get(name);

    if (variant === undefined) {
      throw new Error(`${this.#name} has no ${name} form — check it against pokedex.js`);
    }

    return variant;
  }

  /** Several forms at once, in the order named — a list to spread into a filter's species list. */
  forms(...names: string[]) {
    return names.map((name) => this.form(name));
  }

  /** This species as one region sees it, refusing a region it has no variant in as `form` does. */
  region(region: string): Pokemon {
    const variant = this.#regions.get(region);

    if (variant === undefined) {
      throw new Error(`${this.#name} has no ${region} form — check it against pokedex.js`);
    }

    return variant;
  }

  /**
   * Whether this one is the given region's variant — Paldean Tauros answers to `PALDEA`, and its breeds inherit the
   * region so they answer too. The region is data the variant carries rather than the adjective at the front of its
   * name. Distinct from `regional`, which asks whether a species is a region-locked spawn at all.
   */
  isFrom(region: string) {
    return this.#region === region;
  }

  /** The national dex number, which every form and regional variant of a species shares. */
  get dex() {
    return this.#dex;
  }

  /**
   * The variants hung directly off this one, regions first, each in the order declared — for reading the dex rather
   * than naming a form in a filter. A variant carrying variants answers for them in turn, so Paldean Tauros lists its
   * three breeds and the species lists only Paldean Tauros.
   */
  get variants() {
    return [
      ...[...this.#regions].map(([region, pokemon]) => ({ region, form: null, pokemon })),
      ...[...this.#forms].map(([form, pokemon]) => ({ region: null, form, pokemon })),
    ];
  }

  get baby() {
    return this.#baby;
  }

  get legendary() {
    return this.#legendary;
  }

  get mythical() {
    return this.#mythical;
  }

  /** Whether the wild turns this one up only in its own part of the world. */
  get regional() {
    return this.#regional;
  }

  get released() {
    return this.#released;
  }

  get shinyEligible() {
    return this.#shinyEligible;
  }

  get spawns() {
    return this.#spawns;
  }

  get ultraBeast() {
    return this.#ultraBeast;
  }

  /** Refuse a mutation once frozen, naming the species so a stray call is easy to trace. */
  #assertMutable() {
    if (this.#frozen) {
      throw new Error(`${this.#name} is frozen; set its state in pokedex.js, before the dex is frozen`);
    }
  }

  /** Applies a marker to everything declared last, which is what makes `addForms` one declaration and not several. */
  #mark(apply: (variant: Pokemon) => void) {
    this.#assertMutable();

    for (const variant of this.#declared) {
      apply(variant);
    }

    return this;
  }

  /** Makes the variant just created the cursor, handing it to the callback to say what is true of it. */
  #declare(variant: Pokemon, configure?: (variant: Pokemon) => void) {
    this.#declared = [variant];
    configure?.(variant);
    return this;
  }

  /**
   * Creates a form of this Pokemon and files it under the name the games give it.
   *
   * A name already filed stops the declaration rather than replacing what is under it: a bare `set` would hand the
   * second `addForm('X')` a fresh variant carrying none of the first's markers, leaving the first unreachable through
   * `form` and its `isNotReleased` silently undone.
   */
  #createForm(name: string) {
    this.#assertMutable();

    if (this.#forms.has(name)) {
      throw new Error(`${this.#name} already has a ${name} form — declare each one once in pokedex.js`);
    }

    const variant = this.#variant(`${this.#name} (${name})`);
    this.#forms.set(name, variant);
    return variant;
  }

  /** Creates this Pokemon as one region sees it and files it under that region, refusing a repeat as `#createForm`. */
  #createRegion(region: string) {
    this.#assertMutable();

    if (this.#regions.has(region)) {
      throw new Error(`${this.#name} already has a ${region} variant — declare each one once in pokedex.js`);
    }

    const variant = this.#variant(`${region} ${this.#name}`);
    variant.#region = region;
    this.#regions.set(region, variant);
    return variant;
  }

  /** A form of this species, starting from where the species stands. */
  #variant(name: string) {
    const variant = new Pokemon(this.#dex);
    variant.#name = name;
    variant.#region = this.#region;
    variant.#shinyEligible = this.#shinyEligible;
    variant.#spawns = this.#spawns;
    variant.#released = this.#released;
    variant.#legendary = this.#legendary;
    variant.#mythical = this.#mythical;
    variant.#baby = this.#baby;
    variant.#regional = this.#regional;
    variant.#ultraBeast = this.#ultraBeast;
    return variant;
  }

  toJSON() {
    return this.#dex;
  }

  /** Its name, for reading in a message or a log, where `valueOf` hands back the number. */
  toString() {
    return this.#name;
  }

  valueOf() {
    return this.#dex;
  }
}
