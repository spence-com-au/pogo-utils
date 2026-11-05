/**
 * The ids the stylesheets select on, against the ids the markup actually renders. A page is a component, so an id is
 * written in a `.tsx` rather than in the markup `html-validate` reads, and a rule whose selector matches nothing is an
 * error to nobody: the build succeeds, the page renders, and the only sign is that something looks wrong.
 *
 * It has happened once. Porting the search builder replaced `<code id="query">` with a ref and took
 * `.output code#query` with it, which carried the `user-select: all` the Copy button's clipboard fallback depends on.
 *
 * Ids only, deliberately: every one a stylesheet selects is a literal in some component, where classes are built from
 * data in a dozen places and asking the same question of them would answer with noise.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import postcss, { type AtRule, type Declaration } from 'postcss';
import { expect, test } from 'vitest';

import { PAGES } from './page-table.ts';

const ROOT = join(import.meta.dirname, '..');
const STYLES = join(ROOT, 'src');

/** Every file under `src/`, recursively, whose name ends `ext`. */
const sources = (ext: string) =>
  readdirSync(STYLES, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(ext))
    .map((entry) => join(entry.parentPath, entry.name));

/**
 * The ids a stylesheet selects on, read out of selector text rather than out of the file whole: `#fff` is a colour and
 * `#1a1d25` is another, and both live in declarations. Walking the parsed rules leaves the selectors, including a rule
 * nested right after a `{`: the first under a page's wrapper, or in an `@media` block.
 */
function selectedIds(css: string) {
  const ids = new Set<string>();

  postcss.parse(css).walkRules((rule) => {
    for (const [, id] of rule.selector.matchAll(/#([A-Za-z_][\w-]*)/g)) {
      if (id !== undefined) {
        ids.add(id);
      }
    }
  });

  return ids;
}

test('every id a stylesheet selects on is one the markup renders', () => {
  /**
   * Where an id can be written: a component, or the one document. A literal `id="…"` in either, since that is the form
   * every id these stylesheets name is written in — a computed one would need the check loosened, and none is.
   */
  const markup = [...sources('.tsx'), join(ROOT, 'index.html')].map((path) => readFileSync(path, 'utf8')).join('\n');
  const rendered = new Set([...markup.matchAll(/\bid="([^"{}]+)"/g)].map(([, id]) => id));

  const orphaned: string[] = [];

  for (const sheet of sources('.css')) {
    for (const id of selectedIds(readFileSync(sheet, 'utf8'))) {
      if (!rendered.has(id)) {
        orphaned.push(`${sheet.slice(ROOT.length + 1)} selects #${id}`);
      }
    }
  }

  // Named rather than counted, so a failure says which rule has stopped reaching anything and in which sheet.
  expect(orphaned).toEqual([]);
});

/**
 * Every class name a sheet paints, split by whether the rule narrowed it to one kind of element.
 *
 * `bare` is a rule whose last simple selector is that one class and nothing else, so it paints anything wearing the
 * class. `tagged` is one that put an element type in front of it — `button.ghost` — which is a rule saying *this* kind
 * of element wears the class and something else does too.
 *
 * A second class narrows just as well as a tag does, so `.card.active` is neither: it cannot reach a button, and a
 * sheet pairing it with `.viewtoggle button.active` is not ambiguous about anything.
 */
function paintedClasses(css: string) {
  const bare = new Set<string>();
  const tagged = new Set<string>();
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, ' ');

  for (const [, , selector] of stripped.matchAll(/(^|[}{;])\s*([^{}@][^{}]*?)\s*[{]/g)) {
    for (const part of (selector ?? '').split(',')) {
      const last =
        part
          .trim()
          .split(/[\s>+~]+/)
          .at(-1) ?? '';
      const found = /^([a-zA-Z][\w-]*)?((?:\.[\w-]+)+)/.exec(last);
      const name = found?.[2]?.split('.').at(-1);

      if (!found || name === undefined) {
        continue;
      }

      if (found[1]) {
        tagged.add(name);
      } else if ((found[2]?.match(/\./g) ?? []).length === 1) {
        bare.add(name);
      }
    }
  }

  return { bare, tagged };
}

test('no stylesheet gives one class name to two kinds of element', () => {
  /*
   * The other half of the problem the wrapper comment in `search.css` describes. That one is the page sheets in one
   * document meaning different things by `.chip`; this one is a single sheet doing it, which the wrapper cannot help
   * with and which is quieter — a bare rule and a tagged rule mostly set the same properties, so the tagged one wins
   * and nothing looks wrong until the bare rule holds a property the other does not.
   *
   * It has happened once. The pill that follows the pointer on the Search page was called `.ghost`, which that sheet
   * already gives to the Clear button beside the string. `.output button.ghost` outranked it on every colour the two
   * shared, so the only declaration that leaked was the one the bare rule held alone — and Clear went
   * `position: fixed` and climbed into the Copy button.
   */
  const shared: string[] = [];

  for (const sheet of sources('.css')) {
    const { bare, tagged } = paintedClasses(readFileSync(sheet, 'utf8'));

    for (const name of bare) {
      if (tagged.has(name)) {
        shared.push(`${sheet.slice(ROOT.length + 1)} paints .${name} both bare and behind an element`);
      }
    }
  }

  // Named rather than counted, so a failure says which word has been given two jobs and in which sheet.
  expect(shared.sort()).toEqual([]);
});

/**
 * Every class name a sheet's selectors mention, wherever in the selector it sits. Read through the parser for the
 * reason `hiddenHides` gives, so a nested rule is read by its own selector, and nothing in a comment or a declaration —
 * a `url(x.png)` — is taken for one.
 */
function selectedClasses(css: string) {
  const classes = new Set<string>();

  postcss.parse(css).walkRules((rule) => {
    for (const [, name] of rule.selector.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
      if (name !== undefined) {
        classes.add(name);
      }
    }
  });

  return classes;
}

test('no other stylesheet selects a class the top bar is styled by', () => {
  /*
   * What the wrapper in `search.css` does not cover. It keeps each page's sheet off the other pages, but the bar is
   * inside the body on every page, so a page's rule for one of its own names paints the bar too wherever the bar uses
   * the same name.
   *
   * It has happened once. The Search page's section headings are `.label`, which was also the text beside each tab's
   * icon, so on that page alone every tab's label went 11px, bold and uppercase — and grey on the open tab, the
   * heading's colour set on the label itself outranking the accent it would have inherited from the tab.
   *
   * Any mention rather than only a rule that could reach the bar today: `.card .label` cannot, but whether a context
   * can is a question about the markup that reading the sheets does not answer. The names are the bar's to keep.
   */
  const bar = selectedClasses(readFileSync(join(STYLES, 'nav.css'), 'utf8'));
  const taken: string[] = [];

  for (const sheet of sources('.css').filter((sheet) => sheet !== join(STYLES, 'nav.css'))) {
    for (const name of selectedClasses(readFileSync(sheet, 'utf8'))) {
      if (bar.has(name)) {
        taken.push(`${sheet.slice(ROOT.length + 1)} selects .${name}, which the top bar is styled by`);
      }
    }
  }

  // Named rather than counted, so a failure says which name a page has taken from the bar and in which sheet.
  expect(taken.sort()).toEqual([]);

  // And that the bar's names were read at all, rather than a walk that found nothing to hold the others against.
  expect(bar.size).toBeGreaterThan(0);
});

/**
 * A selector with every `:not(…)` removed, innermost first until it stops changing. `:not([hidden])` selects an element
 * that is *shown*, so a rule keyed on one has nothing to do with hiding and must not be asked to hide unconditionally —
 * `.filters:not([hidden]) ~ .x {display: none}` hides a sibling while the panel is open, and an `!important` there
 * would be wrong. It is the likeliest such shape to arrive, being the alternative the three comments in `events.css`
 * discuss and reject.
 *
 * Two shapes it gets wrong, in opposite directions and neither of them written anywhere. A `[hidden]` behind a second
 * bracketed form inside the `:not` is never reached, so `:not(.a:has([hidden]))` over-reports as keyed; and double
 * negation strips twice, so `:not(:not([hidden]))` loses its key altogether and a hide this gate should hold goes
 * unseen. Closing either wants a selector parser.
 */
function withoutNot(selector: string) {
  let bare = selector;
  let was: string;

  do {
    was = bare;
    bare = bare.replace(/:not\([^()]*\)/g, '');
  } while (bare !== was);

  return bare;
}

/**
 * The rules keyed on the `hidden` attribute, split by what they do with it: `weak` hides the element but can be
 * outranked, `strong` hides it unconditionally, and `kept` is a rule that styles a hidden element without hiding it —
 * a dimming like the one `.chip.off` gives an off chip, which there is nothing to report about.
 *
 * Parsed rather than matched. Every selector in these sheets is nested inside a `body[data-page='…']` wrapper, and a
 * regex over `{…}` cannot read a rule that holds a nested child, a selector list or a descendant without either
 * missing it or taking a declaration above it for part of its selector. A `display` is read off the rule's own
 * declarations rather than through `walkDecls`, which would reach into a nested child and credit its `display` here.
 */
function hiddenHides(css: string) {
  const weak: string[] = [];
  const strong: string[] = [];
  const kept: string[] = [];

  postcss.parse(css).walkRules((rule) => {
    if (!withoutNot(rule.selector).includes('[hidden]')) {
      return;
    }

    const hides = rule.nodes.findLast(
      (node): node is Declaration => node.type === 'decl' && node.prop === 'display' && node.value.trim() === 'none',
    );
    const selector = rule.selector.replace(/\s+/g, ' ').trim();

    if (hides === undefined) {
      kept.push(selector);
    } else {
      (hides.important ? strong : weak).push(selector);
    }
  });

  return { weak, strong, kept };
}

test('every rule that hides an element by its `hidden` attribute outranks the sheet around it', () => {
  /*
   * An author `display` beats the UA stylesheet's `[hidden] {display: none}`, so a sheet that lays an element out has
   * to hide it back — and the rule doing that has to win against every other `display` the sheet gives the same
   * element. Specificity is not enough to promise it: an attribute selector scores as a class, so `.pane[hidden]` ties
   * `.pane.panel` and loses to it on order, which painted the whole Advanced pane under the Builder tab.
   *
   * `!important` is what makes the hide unconditional, and it is the one declaration in these sheets that wants to be:
   * nothing on any page has a reason to lay out an element the markup has hidden.
   */
  const weak: string[] = [];
  let found = 0;

  for (const sheet of sources('.css')) {
    const hides = hiddenHides(readFileSync(sheet, 'utf8'));

    found += hides.weak.length + hides.strong.length + hides.kept.length;
    weak.push(...hides.weak.map((selector) => `${sheet.slice(ROOT.length + 1)} hides ${selector} without !important`));
  }

  // Named rather than counted, so a failure says which rule can be outranked and in which sheet.
  expect(weak.sort()).toEqual([]);

  /*
   * And that there were rules to check at all, rather than a walk that found no sheets. A floor and nothing more: a
   * parser either reads the sheet or throws on it, so there is no pattern here that can quietly stop matching and no
   * second count to hold it to.
   */
  expect(found).toBeGreaterThan(0);
});

/**
 * The page names a sheet scopes itself to, out of its `body[data-page='…']` wrappers. Comments are stripped first,
 * because the wrapper is discussed in prose in most of these sheets.
 */
function scopedPages(css: string) {
  const pages = new Set<string>();
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

  for (const [, page] of bare.matchAll(/\[data-page=['"]([^'"]*)['"]\]/g)) {
    if (page !== undefined) {
      pages.add(page);
    }
  }

  return pages;
}

/**
 * The page names the router's table holds. Imported from `src/page-table.ts` rather than read out of `src/router.ts`
 * as text, which this used to do because `router.ts` reaches `history` and this project carries no DOM lib: the table
 * moved out on its own so the build could write the manifest from it, and a regex over source was the one part of this
 * check that could stop matching and report nothing.
 */
const routerPages = () => new Set<string>(PAGES.map((page) => page.name));

test('every page a stylesheet scopes itself to is one the router has', () => {
  /*
   * `data-page` is written onto the body from `PAGES`, so a sheet scoping to a name that table no longer holds paints
   * nothing at all. Neither check above would notice: the rules parse, the ids still resolve, the page renders — and
   * every class in the sheet is simply unstyled.
   *
   * Renaming a page is what reaches this. The router entry, the chunk table and the stylesheet import are checked by
   * `tsc`; the attribute value in the sheet is a string on both ends and was checked by nothing.
   */
  const named = routerPages();

  const orphaned: string[] = [];

  for (const sheet of sources('.css')) {
    for (const page of scopedPages(readFileSync(sheet, 'utf8'))) {
      if (!named.has(page)) {
        orphaned.push(`${sheet.slice(ROOT.length + 1)} scopes to [data-page='${page}']`);
      }
    }
  }

  // Named rather than counted, so a failure says which sheet has stopped reaching its page, and which page it wanted.
  expect(orphaned.sort()).toEqual([]);
});

/**
 * The top-level nodes of a page sheet that sit outside its `body[data-page='…']` wrapper, as the selector or at-rule
 * they open with. A `@keyframes` is let through because its name is global wherever it sits, so scoping it would change
 * nothing and a style rule cannot hold one; `GLOBAL` names the rest, which are global on purpose.
 */
function unwrapped(css: string, page: string) {
  const wrapper = `body[data-page='${page}']`;
  const stray: string[] = [];

  postcss.parse(css).each((node) => {
    if (node.type === 'comment' || (node.type === 'atrule' && node.name === 'keyframes')) {
      return;
    }

    const opens =
      node.type === 'rule'
        ? node.selector.replace(/\s+/g, ' ').trim()
        : node.type === 'atrule'
          ? `@${node.name} ${node.params}`
          : node.type;

    if (opens !== wrapper && !GLOBAL.has(`${page}: ${opens}`)) {
      stray.push(opens);
    }
  });

  return stray;
}

/** The rules a page sheet keeps outside its wrapper on purpose, each as `<page>: <selector>`. */
const GLOBAL = new Set(['map: html, body']);

test('every top-level rule in a page sheet sits inside its own wrapper', () => {
  /*
   * `main.tsx` bundles every page sheet into the one `main.css`, which is safe only because each is wrapped in
   * `body[data-page='…']` and so inert on the other pages. The check above covers a wrapper that names a page the
   * router lacks; this covers a wrapper that is missing or names another page, and a rule written after it at the top
   * level. Any of them restyles every other tab and passes everything else here, since the collision checks compare
   * class names only within one sheet or against the bar's.
   *
   * `theme.css`, `nav.css` and `chrome.css` are the shell's own and global by design, so only the sheets named for a
   * page are read.
   */
  const stray = PAGES.flatMap(({ name }) =>
    unwrapped(readFileSync(join(STYLES, `${name}.css`), 'utf8'), name).map(
      (opens) => `${name}.css has \`${opens}\` outside its wrapper`,
    ),
  );

  // Named rather than counted, so a failure says which sheet leaks and through which rule.
  expect(stray).toEqual([]);
});

test('the wrapper check can tell a wrapped rule from a stray one', () => {
  // The same reason the others have one: a walk that visited nothing would report no strays however many there were.
  expect(unwrapped("body[data-page='map'] { .a { color: red } }", 'map')).toEqual([]);
  expect(unwrapped("body[data-page='map'] { color: red } .a { color: red }", 'map')).toEqual(['.a']);

  // Another page's wrapper is not this page's, and a media query at the top level has escaped the wrapper too.
  expect(unwrapped("body[data-page='search'] { color: red }", 'map')).toEqual(["body[data-page='search']"]);
  expect(unwrapped('@media (width <= 560px) { .a { color: red } }', 'map')).toEqual(['@media (width <= 560px)']);

  // The two ways through: a keyframe set, and a rule `GLOBAL` names for that page alone.
  expect(unwrapped('@keyframes spin { from { opacity: 0 } }', 'map')).toEqual([]);
  expect(unwrapped('html,\nbody { height: 100% }', 'map')).toEqual([]);
  expect(unwrapped('html, body { height: 100% }', 'events')).toEqual(['html, body']);
});

test('the page check can tell a scoped sheet from an unscoped one', () => {
  // The same reason the other two have one: a selector regex that matched nothing would report no orphans however many
  // there were.
  expect(scopedPages("body[data-page='search'] { .chip { color: red } }")).toEqual(new Set(['search']));
  expect(scopedPages('body[data-page="map"] .sidebar { color: red }')).toEqual(new Set(['map']));

  // An unscoped sheet names no page, and a wrapper quoted in prose is not one either.
  expect(scopedPages('.backup { color: red }')).toEqual(new Set());
  expect(scopedPages("/* body[data-page='gone'] */ .backup { color: red }")).toEqual(new Set());

  // And that the router's real table is what the check reads it against.
  const pages = routerPages();

  expect([pages.has('events'), pages.has('integrations'), pages.has('pgsharp')]).toEqual([true, true, false]);
});

test('the class check can tell a shared name from a narrowed one', () => {
  // The same reason the id check has one of these: a selector regex that matched nothing would report no collisions
  // however many there were.
  const collides = paintedClasses('.ghost { position: fixed } .output button.ghost { color: red }');

  expect([collides.bare.has('ghost'), collides.tagged.has('ghost')]).toEqual([true, true]);

  // A second class narrows a rule as well as a tag does, so this pair is not ambiguous and must not be reported.
  const narrowed = paintedClasses('.card.active { color: red } .viewtoggle button.active { color: blue }');

  expect([narrowed.bare.has('active'), narrowed.tagged.has('active')]).toEqual([false, true]);

  // A descendant is not a narrowing of this kind — a base rule and a contextual override are ordinary CSS — so the
  // pair that is looked for is a tag against a bare class and nothing else.
  const nested = paintedClasses('.pill { color: red } .parts .pill { color: blue }');

  expect([nested.bare.has('pill'), nested.tagged.has('pill')]).toEqual([true, false]);
});

test('the bar check reads every class a selector mentions and nothing else', () => {
  // The same reason the others have one: a reader that found nothing would report no taken names however many there
  // were.
  expect(selectedClasses('.topnav .tab .tab-label:hover, .menu > .x { color: red }')).toEqual(
    new Set(['topnav', 'tab', 'tab-label', 'menu', 'x']),
  );

  // Nested under a page's wrapper, which is the shape every page sheet is in.
  expect(selectedClasses("body[data-page='search'] { --w: 9px; .label { color: red } }")).toEqual(new Set(['label']));

  // A comment and a declaration's value are not selectors.
  expect(selectedClasses('/* .gone */ .a { background: url(x.png) }')).toEqual(new Set(['a']));
});

test('the check can tell a missing id from a present one', () => {
  // Otherwise the assertion above passes on an empty set for the wrong reason — a selector regex that matched nothing
  // would report no orphans however many there were, which is exactly how this bug went unnoticed in the first place.
  expect(selectedIds('.output code#query { color: red }')).toEqual(new Set(['query']));
  expect(selectedIds('#sidebar header { padding: 0 }')).toEqual(new Set(['sidebar']));

  // A colour is not an id, and neither is one inside a declaration.
  expect(selectedIds('body { color: #fff; background: #1a1d25 }')).toEqual(new Set());

  // More than one in a list, and more than one in a selector.
  expect(selectedIds('#a .x, #b .y { color: red }')).toEqual(new Set(['a', 'b']));

  // Nested under a page's wrapper or an at-rule, where the first rule follows a `{` rather than a `}`.
  expect(selectedIds("body[data-page='map'] { #root { color: red } }")).toEqual(new Set(['root']));
  expect(selectedIds('@media (width < 600px) { #a { color: red } }')).toEqual(new Set(['a']));
});

test('the hiding check can tell an outranked rule from an unconditional one', () => {
  // The same reason the other three have one: a reader that found nothing would report no weak rules however many
  // there were.
  expect(hiddenHides('.pane[hidden] { display: none }')).toEqual({ weak: ['.pane[hidden]'], strong: [], kept: [] });
  expect(hiddenHides('.pane[hidden] { display: none !important }')).toEqual({
    weak: [],
    strong: ['.pane[hidden]'],
    kept: [],
  });

  // A rule nested under the wrapper's own declarations keeps its selector and nothing of theirs, which is the shape
  // `pokedex.css` is in.
  expect(hiddenHides("body[data-page='x'] { --w: 9px; [hidden] { display: none !important } }")).toEqual({
    weak: [],
    strong: ['[hidden]'],
    kept: [],
  });

  /*
   * The four shapes a regex over `{…}` got wrong, each of which is valid CSS this check has no business failing: a
   * rule keyed on `[hidden]` that dims rather than hides, one that hides a descendant of the hidden element, one in a
   * selector list, and one holding a nested child. The first is the shape `.chip.off` is in two rules along.
   */
  expect(hiddenHides('.chip[hidden] { opacity: 0 }')).toEqual({ weak: [], strong: [], kept: ['.chip[hidden]'] });
  expect(hiddenHides('.pane[hidden] .x { display: none !important }')).toEqual({
    weak: [],
    strong: ['.pane[hidden] .x'],
    kept: [],
  });
  expect(hiddenHides('.a[hidden],\n.b { display: none !important }')).toEqual({
    weak: [],
    strong: ['.a[hidden], .b'],
    kept: [],
  });
  expect(hiddenHides('.a[hidden] { display: none !important; & .y { color: red } }')).toEqual({
    weak: [],
    strong: ['.a[hidden]'],
    kept: [],
  });

  // A nested child's own `display` is the child's, not the hiding rule's, so a rule that only hides through one of
  // those is still a rule that does not hide the hidden element.
  expect(hiddenHides('.a[hidden] { color: red; & .y { display: none } }')).toEqual({
    weak: [],
    strong: [],
    kept: ['.a[hidden]'],
  });

  // `hidden` is not the only attribute a sheet selects on, and one it is not keyed on is not this check's business.
  expect(hiddenHides('.tab[aria-selected] { display: flex }')).toEqual({ weak: [], strong: [], kept: [] });
});

test('a rule keyed on a shown element is not a hiding rule', () => {
  /*
   * `:not([hidden])` is the other way round — it selects what is *on* screen — so neither of these is this check's
   * business, and the first is ordinary CSS an `!important` would be wrong on: hide a sibling while the panel is open.
   */
  expect(hiddenHides('.filters:not([hidden]) ~ .x { display: none }')).toEqual({ weak: [], strong: [], kept: [] });
  expect(hiddenHides('.newly:not([hidden]) { display: flex }')).toEqual({ weak: [], strong: [], kept: [] });

  // Both forms in one selector is still keyed, the `.b[hidden]` half being a hide that can be outranked.
  expect(hiddenHides('.a:not([hidden]) .b[hidden] { display: none }')).toEqual({
    weak: ['.a:not([hidden]) .b[hidden]'],
    strong: [],
    kept: [],
  });

  // Stripping is innermost-first and repeats, so a stack of them goes.
  expect(hiddenHides('.a:not(.b):not([hidden]) { display: flex }')).toEqual({ weak: [], strong: [], kept: [] });

  /*
   * Both limits `withoutNot` documents, pinned rather than left to be discovered, and they fall opposite ways. A
   * `[hidden]` behind a second bracketed form inside the `:not` is never reached, so the first over-reports as keyed;
   * double negation strips twice and the second loses its key, so a hide of a hidden element goes unseen. No sheet
   * writes either, and closing them wants a selector parser — this says what the check does, not what it should.
   */
  expect(hiddenHides('.z:not(.a:has([hidden])) { display: none }')).toEqual({
    weak: ['.z:not(.a:has([hidden]))'],
    strong: [],
    kept: [],
  });
  expect(hiddenHides('.a:not(:not([hidden])) { display: none }')).toEqual({ weak: [], strong: [], kept: [] });

  /*
   * `:is`, `:where` and `:has` around a plain `[hidden]` stay keyed, which is the right answer rather than a limit:
   * each selects the hidden element, where `:not` selects the shown one, so each is a hide to be held to the flag.
   */
  expect(hiddenHides('.a:is([hidden]) { display: none }')).toEqual({
    weak: ['.a:is([hidden])'],
    strong: [],
    kept: [],
  });
});

/**
 * The sheets under `src/` that `main.tsx` imports, resolved to paths. Only relative specifiers are this check's: a
 * package's sheet — `leaflet/dist/leaflet.css` — lives outside `src/` and is no file the walk would find.
 */
function importedSheets(source: string) {
  return new Set(
    [...source.matchAll(/^import\s+['"](\.{1,2}\/[^'"]+\.css)['"];?$/gm)].map(([, spec]) => join(STYLES, spec ?? '')),
  );
}

test('every stylesheet under src/ is imported from main.tsx', () => {
  /*
   * The half of "every sheet is imported from the entry" that `scripts/assemble.mts` cannot see. A sheet imported from
   * a page reaches `dist/src/` and is caught there as one no document links; a sheet nothing imports never enters
   * esbuild's graph, never reaches `dist/`, and leaves its page unstyled with the build and every check above green —
   * those walk `src/`, so they check a forgotten sheet's scoping as carefully as a loaded one's.
   */
  const imported = importedSheets(readFileSync(join(STYLES, 'main.tsx'), 'utf8'));
  const missing = sources('.css')
    .filter((sheet) => !imported.has(sheet))
    .map((sheet) => `${sheet.slice(ROOT.length + 1)} is not imported from src/main.tsx`);

  // Named rather than counted, so a failure says which sheet is never loaded.
  expect(missing.sort()).toEqual([]);

  // And that the imports were read at all, rather than a pattern matching nothing against a walk that found nothing.
  expect(imported.size).toBeGreaterThan(0);
});

test('the import check reads relative sheets and nothing else', () => {
  const imported = importedSheets(
    [
      "import './theme.css';",
      'import "./nested/page.css"',
      "import 'leaflet/dist/leaflet.css';",
      "import { byId } from './dom.js';",
      "// import './commented.css';",
    ].join('\n'),
  );

  expect(imported).toEqual(new Set([join(STYLES, 'theme.css'), join(STYLES, 'nested/page.css')]));
});

/** `#rgb` or `#rrggbb` as lower-case `#rrggbb`, so `#fff` in one file and `#ffffff` in another compare equal. */
function hex(colour: string) {
  const digits = colour.trim().toLowerCase().replace(/^#/, '');

  return `#${digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits}`;
}

/**
 * The custom properties `theme.css` sets on `:root`, in the light palette and in the dark one: a `:root` rule at the
 * top level is light, one under the `prefers-color-scheme: dark` query is dark, and one anywhere else is neither.
 */
function palettes(css: string) {
  const light = new Map<string, string>();
  const dark = new Map<string, string>();

  postcss.parse(css).walkRules(':root', (rule) => {
    const parent = rule.parent;
    const query = parent?.type === 'atrule' ? (parent as AtRule).params : undefined;
    const into =
      parent?.type === 'root' ? light : query !== undefined && /prefers-color-scheme:\s*dark/.test(query) ? dark : null;

    for (const node of rule.nodes) {
      if (into !== null && node.type === 'decl' && node.prop.startsWith('--')) {
        into.set(node.prop, node.value.trim());
      }
    }
  });

  return { light, dark };
}

test('every copy of a theme colour outside the stylesheets matches the token it copies', () => {
  /*
   * The browser chrome, the installed app and the tab icon are painted from files that cannot read a custom property —
   * a `<meta>`, a JSON manifest and an SVG a browser renders on its own — so each carries the colour by hand. Retuning
   * `theme.css` would leave every one of them on the old value with the build green, and `scripts/build-icons.mts`
   * paints the maskable icon's plate from `background_color`, so the installed icon would drift with it.
   */
  const { light, dark } = palettes(readFileSync(join(STYLES, 'theme.css'), 'utf8'));
  const token = (palette: Map<string, string>, name: string) => hex(palette.get(name) ?? `missing ${name}`);

  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const themeColor = (scheme: string) =>
    new RegExp(`<meta name="theme-color" content="([^"]+)" media="\\(prefers-color-scheme: ${scheme}\\)"`).exec(
      html,
    )?.[1];

  expect({ light: themeColor('light'), dark: themeColor('dark') }).toEqual({
    light: token(light, '--panel'),
    dark: token(dark, '--panel'),
  });

  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')) as Record<string, string>;

  expect({ background: manifest['background_color'], theme: manifest['theme_color'] }).toEqual({
    background: token(light, '--bg'),
    theme: token(light, '--panel'),
  });

  /*
   * The favicon's colours as a set rather than element by element: the red half is `--accent`, the band, the button's
   * outline and the light rim are `--text`, and the dark rim is the dark `--text`. The ball's white is the ball's own
   * rather than a token's, so it is named as a literal.
   */
  const svg = readFileSync(join(ROOT, 'favicon.svg'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const painted = new Set([...svg.matchAll(/#(?:[\da-f]{6}|[\da-f]{3})\b/gi)].map(([colour]) => hex(colour)));

  expect(painted).toEqual(
    new Set([token(light, '--accent'), token(light, '--text'), token(dark, '--text'), '#ffffff']),
  );
});

test('the palette reader keeps the light and dark tokens apart', () => {
  // The same reason the others have one: a reader that found nothing would hold every copy against nothing.
  const both =
    ':root { --a: #fff; color-scheme: light dark } @media (prefers-color-scheme: dark) { :root { --a: #000 } }';

  expect(palettes(both)).toEqual({ light: new Map([['--a', '#fff']]), dark: new Map([['--a', '#000']]) });

  // A `:root` under some other query is neither palette.
  expect(palettes('@media print { :root { --a: #fff } }')).toEqual({ light: new Map(), dark: new Map() });

  expect([hex('#FFF'), hex('#1a1d25')]).toEqual(['#ffffff', '#1a1d25']);
});
