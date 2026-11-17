/**
 * The repository's GPX files as the two Node-side readers see them: which files there are, how to parse one, where its
 * `<pgr:event>` references are and how to cut one out. `validate-gpx.mts` refuses a reference naming an `eventID`
 * `data/events.json` does not have and `prune-events.mts` deletes the references whose event it just removed, so a
 * reference the pruner cannot see is one the validator then refuses — failing every later Pages deploy until someone
 * edits the file by hand. Both read references through `eventRefs` so one reading cannot disagree with itself.
 *
 * An `.mts` beside `gpx.ts` because this reaches `node:child_process` and `@xmldom/xmldom`, where `gpx.ts` is handed
 * one file over `fetch` and never lists the repository.
 */

import { PGR_NS } from './gpx-dialect.ts';
import { DOMParser, Node, type Document, type Element } from '@xmldom/xmldom';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * A `<pgr:event>`, the `eventID` it names and the `<trk>` or `<wpt>` whose `<extensions>` holds it, if one does.
 * `temporary` is `temporary="true"` on the element, which says the entry is there only for the event and goes when the
 * event does, where without it the entry stands on its own and loses only the reference.
 */
export type EventRef = { element: Element; entry: Element | undefined; eventID: string; temporary: boolean };

/**
 * Every GPX file in the repository, with its contents. `git ls-files` rather than a walk of `data/`, so an untracked
 * file is neither checked nor pruned, and it sorts its own output — which is what lets `GPX_PATHS` be written from
 * this list and still give the same bytes on two runs.
 */
export function gpxSources() {
  const files = execFileSync('git', ['ls-files', '-z', '*.gpx'], { encoding: 'utf8' }).split('\0').filter(Boolean);

  return files.map((fileName) => ({ fileName, contents: readFileSync(fileName, 'utf8') }));
}

/**
 * `contents` as a document, throwing on a file that is not well-formed. xmldom hands a fatal error to this handler and
 * returns a document regardless, so without the throw a malformed file reads as an empty one — to the pruner, a file
 * with no references to cut rather than one it could not read.
 */
export function parseGpx(contents: string) {
  return new DOMParser({
    onError: (level, msg) => {
      if (level === 'fatalError') {
        throw new Error(msg);
      }
    },
  }).parseFromString(contents, 'application/xml');
}

/**
 * Every `<pgr:event>` in `doc`, with the `eventID` it names. Matched on namespace and local name rather than a `pgr:`
 * prefix, which a file binds as it likes, and trimmed because both callers weigh it against an `eventID` read out of
 * JSON. The whole document rather than the entries the viewer reads: a reference anywhere in the file is one the
 * validator can refuse, so it is one the pruner has to find.
 */
export function eventRefs(doc: Document): EventRef[] {
  return Array.from(doc.getElementsByTagNameNS(PGR_NS, 'event')).map((element) => {
    const extensions = element.parentNode;
    const entry = extensions?.localName === 'extensions' ? extensions.parentNode : null;

    return {
      element,
      entry: entry && ENTRY_NAMES.has(entry.localName ?? '') ? (entry as Element) : undefined,
      eventID: element.textContent?.trim() ?? '',
      temporary: element.getAttribute('temporary') === 'true',
    };
  });
}

const ENTRY_NAMES = new Set(['trk', 'wpt']);

/**
 * The `<trk>`s and `<wpt>`s in `doc` the viewer turns into entries. A `<trk>` with no `<trkpt>` is what a cleared track
 * looks like on export, and the viewer skips it, so it is no entry. The validator refuses a file with none, and the
 * pruner deletes a file it would leave with none rather than write one the validator refuses.
 */
export function entryElements(doc: Document) {
  const tracks = Array.from(doc.getElementsByTagName('trk')).filter((trk) => trk.getElementsByTagName('trkpt').length);

  return [...tracks, ...Array.from(doc.getElementsByTagName('wpt'))];
}

/**
 * The element children of `el`, in document order. `childNodes` carries the whitespace between tags too, so the text
 * nodes are filtered out.
 */
export const elementChildren = (el: Element): Element[] =>
  Array.from(el.childNodes).filter((node): node is Element => node.nodeType === Node.ELEMENT_NODE);

/**
 * `contents` with every element of `elements` cut out, each taking the whitespace that indented it where it had a line
 * to itself, and one blank line beside it where one set it apart from its neighbours.
 *
 * Spliced out of the source text rather than written back through `XMLSerializer`, which does not round-trip a file
 * here: it collapses the newline between the two `xmlns` attributes every `<gpx>` root in `data/` carries, so taking
 * one line out of one file would reformat all of them.
 *
 * Spans that touch, or that only blank lines part, are merged before the blank line beside them is taken: two
 * neighbouring entries cut one at a time would each claim the blank line between them, and leave the one beyond. Then
 * applied back to front, so cutting the earlier of two cannot move the offsets of the later.
 */
export function cutElements(contents: string, elements: readonly Element[]) {
  const spans = elements.map((element) => spanOf(contents, element)).sort(([a], [b]) => a - b);
  const merged: [number, number][] = [];

  for (const [from, to] of spans) {
    const last = merged.at(-1);

    if (last && from <= pastBlankLines(contents, last[1])) {
      last[1] = Math.max(last[1], to);
    } else {
      merged.push([from, to]);
    }
  }

  return merged
    .map((span) => withBlankLine(contents, span))
    .reverse()
    .reduce((text, [from, to]) => text.slice(0, from) + text.slice(to), contents);
}

/** A line of nothing but spaces and tabs, matched where `lastIndex` puts it. */
const BLANK_LINE = /[ \t]*(?:\r\n|[\n\r])/y;

/**
 * A blank line at the end of the text, after the terminator of the line before it: `\r(?!\n)` keeps the `\r` of a CRLF
 * from reading as that terminator and the `\n` after it as a blank line.
 */
const BLANK_LINE_BEFORE = /(?<=^|\r\n|\n|\r(?!\n))[ \t]*(?:\r\n|[\n\r])$/;

/** Whether `at` is the first offset of a line, as against inside one or between the two halves of a CRLF. */
const startsLine = (contents: string, at: number) =>
  at === 0 || contents[at - 1] === '\n' || (contents[at - 1] === '\r' && contents[at] !== '\n');

/** The offset past any blank lines from `at`, or `at` itself where it is not the start of a line. */
function pastBlankLines(contents: string, at: number) {
  let offset = at;

  while (startsLine(contents, offset)) {
    BLANK_LINE.lastIndex = offset;

    if (!BLANK_LINE.test(contents)) {
      break;
    }

    offset = BLANK_LINE.lastIndex;
  }

  return offset;
}

/**
 * A span of whole lines widened by the blank line before it, or failing one the blank line after — so a block that had
 * a blank line on both sides keeps one, and one at either end of its parent leaves none against the tag beside it. A
 * span within a line has no blank line of its own and is returned as it is.
 */
function withBlankLine(contents: string, [from, to]: [number, number]): [number, number] {
  if (!startsLine(contents, from) || !startsLine(contents, to)) {
    return [from, to];
  }

  const before = BLANK_LINE_BEFORE.exec(contents.slice(0, from));

  if (before) {
    return [from - before[0].length, to];
  }

  BLANK_LINE.lastIndex = to;

  return BLANK_LINE.test(contents) ? [from, BLANK_LINE.lastIndex] : [from, to];
}

/**
 * The half-open range of `contents` that `element` occupies, widened to the whole line where nothing else shares one.
 *
 * Every step refuses rather than guesses, because the failure it guards is silent: a span that over-runs deletes
 * whatever followed, the result can still be well-formed XML, and this is committed to `master` unattended.
 */
function spanOf(contents: string, element: Element): [number, number] {
  const start = startOf(contents, element);

  return wholeLine(contents, start, endOf(contents, element, start));
}

/** The offset of `element`'s start tag in `contents`, refused unless the start tag is really there. */
function startOf(contents: string, element: Element) {
  const { lineNumber, columnNumber, tagName } = element;

  // Truthiness rather than a null test, which is what narrows away the `undefined` xmldom also types these as. Both
  // are 1-based, so a `0` is as absent as the other two.
  if (!lineNumber || !columnNumber) {
    throw new Error(`<${tagName}> was parsed without a position, so there is nothing to cut`);
  }

  const lineStart = startOfLine(contents, lineNumber);
  const start = (lineStart ?? 0) + columnNumber - 1;

  /*
   * That the start tag really is at the offset reconstructed for it. The parser reports a line and a column rather
   * than an offset, so this file counts line terminators the way the parser counted them — and a disagreement about
   * what ends a line would otherwise splice through unrelated content.
   */
  if (lineStart === null || !contents.startsWith(`<${tagName}`, start)) {
    throw new Error(`<${tagName}> is not at ${lineNumber}:${columnNumber} where the parser put it — refusing to cut`);
  }

  return start;
}

/**
 * The offset line `lineNumber` starts at, 1-based, or `null` where the file has no such line. XML ends a line with
 * `\n`, `\r\n` or a bare `\r` alike (production 2.11), where `split('\n')` sees only the first two — and the parser
 * reporting positions here counts all three.
 */
function startOfLine(contents: string, lineNumber: number) {
  const breaks = /\r\n|[\n\r]/g;
  let offset = 0;

  for (let line = 1; line < lineNumber; line++) {
    const next = breaks.exec(contents);

    if (next === null) {
      return null;
    }

    offset = next.index + next[0].length;
  }

  return offset;
}

/**
 * The offset just past `element`'s own end tag, given the `start` of its start tag.
 *
 * Found from the element's own extent rather than by searching for the literal `</tagName>`, which `indexOf` would
 * answer with the first occurrence anywhere after `start`. Whitespace is legal before the `>` of an end tag
 * (production 42), so `</pgr:event >` is this element's end and the literal is not, and a comment child may carry the
 * literal itself. Either way the span runs past the element and the result can still be well-formed.
 *
 * A `<` cannot appear in text or in an attribute value, so the first one after the start tag, or after a child's end,
 * opens this element's end tag, its next child element, a comment or CDATA. A child element is stepped over by its own
 * extent, found the same way and only where it starts at the offset the parser gave it. Nothing else is an extent this
 * can read, and the rest throw.
 */
function endOf(contents: string, element: Element, start: number): number {
  const { tagName } = element;
  const startTagEnd = contents.indexOf('>', start);

  if (startTagEnd === -1) {
    throw new Error(`<${tagName}> has an unterminated start tag — refusing to cut`);
  }

  // `<x/>` holds nothing and ends where its start tag does.
  if (contents[startTagEnd - 1] === '/') {
    return startTagEnd + 1;
  }

  let close = contents.indexOf('<', startTagEnd + 1);

  for (const child of elementChildren(element)) {
    const childStart = startOf(contents, child);

    if (close !== childStart) {
      break;
    }

    close = contents.indexOf('<', endOf(contents, child, childStart));
  }

  const endTag = close === -1 ? null : /^<\/([^\s/>]+)[ \t\r\n]*>/.exec(contents.slice(close));

  if (endTag === null || endTag[1] !== tagName) {
    const found = close === -1 ? 'the end of the file' : JSON.stringify(contents.slice(close, close + 24));

    throw new Error(`<${tagName}> is followed by ${found}, not by its own end tag — refusing to cut`);
  }

  return close + endTag[0].length;
}

/**
 * `[start, end)` widened to the whole line where only whitespace shares it, so the cut leaves behind neither a blank
 * line nor one of trailing spaces — nothing formats these files afterwards. An element inline among siblings keeps its
 * line and loses only itself, which a whole-line cut would get wrong by taking a `<pgr:country>` with it.
 */
function wholeLine(contents: string, start: number, end: number): [number, number] {
  let from = start;
  let to = end;

  while (from > 0 && (contents[from - 1] === ' ' || contents[from - 1] === '\t')) {
    from--;
  }

  while (contents[to] === ' ' || contents[to] === '\t') {
    to++;
  }

  // Against the three terminators rather than `\n`, for the reason `startOfLine` counts them: on a CRLF file the `\r`
  // has to fall inside the span, not survive as a line of its own.
  const opensLine = from === 0 || contents[from - 1] === '\n' || contents[from - 1] === '\r';
  const closesLine = /^(?:\r\n|[\n\r])/.exec(contents.slice(to));

  return opensLine && closesLine ? [from, to + closesLine[0].length] : [start, end];
}
