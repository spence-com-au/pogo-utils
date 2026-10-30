/**
 * What `scripts/assemble.mts` copies into the artifact and what it refuses to publish. Each check there exists because
 * the build once succeeded over an artifact that was wrong — a build cache deployed, five stylesheets nothing loaded —
 * so the cases below are artifacts that are wrong in one way each, built in a directory of their own.
 *
 * The real artifact is the integration case, and CI builds it. What that cannot show is a check that has stopped
 * refusing: a build over a correct artifact passes whether the check works or not.
 */

import {
  copyInto,
  expandEntry,
  lfsPointers,
  localTarget,
  manifestLinks,
  markupRefs,
  orphanedStylesheets,
  refsOf,
  scanReferences,
  unservedFiles,
  VENDORED,
} from './artifact.mts';
import { TESSERACT_VENDOR } from './generated.ts';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, test } from 'vitest';

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A directory holding `files`, by path, removed after the test. */
function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'assemble-'));
  made.push(dir);

  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), contents);
  }

  return dir;
}

const MANIFEST = JSON.stringify({ start_url: './', icons: [{ src: 'icons/192.png' }] });

const page = (body: string) => `<link rel="manifest" href="manifest.json">${body}`;

test('localTarget passes over anything not fetched from this origin by path', () => {
  for (const ref of [
    'https://cdn.example/x.js',
    '//cdn.example/x.js',
    '#top',
    'data:image/png;base64,AA',
    'mailto:a',
  ]) {
    expect(localTarget('index.html', ref)).toBeNull();
  }
});

test('localTarget resolves against the naming file, drops the query and decodes the path', () => {
  expect(localTarget('index.html', 'src/main.js?v=1#x')).toBe('src/main.js');
  expect(localTarget('index.html', 'data/Melbourne%20Zoo.gpx')).toBe('data/Melbourne Zoo.gpx');
  expect(localTarget('icons/manifest.json', '../src/main.js')).toBe('src/main.js');
  expect(localTarget('icons/manifest.json', '192.png')).toBe('icons/192.png');
});

/*
 * The two forms `join` would normalise into a path inside the artifact: `/src/main.js` into `src/main.js`, which 404s
 * from the Pages subdirectory, and `../package.json` into the repository's own, which is there to be found.
 */
test('localTarget refuses a path that leaves the artifact rather than resolving it', () => {
  expect(() => localTarget('index.html', '/src/main.js')).toThrow(
    'index.html names /src/main.js, which leaves the Pages subdirectory',
  );
  expect(() => localTarget('index.html', '../package.json')).toThrow(
    'index.html names ../package.json, which leaves the artifact',
  );
  expect(() => localTarget('icons/manifest.json', '../../package.json')).toThrow('which leaves the artifact');
  expect(() => localTarget('index.html', '..')).toThrow('which leaves the artifact');

  // A name that only begins with two dots stays inside.
  expect(localTarget('index.html', '..x/y.js')).toBe('..x/y.js');
});

test('a scan over an artifact naming a file outside it fails, though the file is there to be found', () => {
  const root = tree({
    'dist/index.html': page('<script src="../outside.js"></script>'),
    'dist/manifest.json': MANIFEST,
    'outside.js': '',
  });

  expect(() => scanReferences(join(root, 'dist'))).toThrow('index.html names ../outside.js, which leaves the artifact');
});

test('every src and href is read, and a manifest link with its attributes in either order', () => {
  expect(markupRefs('<script src="a.js"></script><a href="b.html">b</a>')).toEqual(['a.js', 'b.html']);
  expect(manifestLinks('<link href="m.json" rel="manifest"><link rel="manifest" href="n.json">')).toEqual([
    'm.json',
    'n.json',
  ]);
  expect(manifestLinks('<link rel="stylesheet" href="s.css">')).toEqual([]);
});

test('refsOf walks the manifest to any depth, for src, url and start_url only', () => {
  const manifest = {
    name: 'x',
    start_url: './',
    icons: [{ src: 'a.png', sizes: '192x192' }],
    shortcuts: [{ name: 'y', url: './#/y', icons: [{ src: 'b.png' }] }],
  };

  expect([...refsOf(manifest)]).toEqual(['./', 'a.png', './#/y', 'b.png']);
});

test('a reference the artifact holds passes, and one it does not is missing', () => {
  const dist = tree({
    'index.html': page('<script src="src/main.js"></script><img src="gone.png"><a href="https://example.com">x</a>'),
    'manifest.json': MANIFEST,
    'src/main.js': '',
    'icons/192.png': '',
  });

  const { checked, missing, named, pages, manifests } = scanReferences(dist);

  expect(pages).toEqual(['index.html']);
  expect([...manifests]).toEqual(['manifest.json']);
  expect(missing).toEqual(['index.html names gone.png']);
  expect(named).toEqual(new Set(['manifest.json', 'src/main.js', 'gone.png', './', 'icons/192.png']));
  expect(checked).toBe(5);
});

test('a manifest member that is a bare fragment names the manifest itself, and is refused', () => {
  const dist = tree({
    'index.html': page(''),
    'manifest.json': JSON.stringify({ start_url: '#/events' }),
  });

  expect(scanReferences(dist).missing).toEqual(['manifest.json names #/events, which resolves to the manifest itself']);
});

test('a manifest icon the artifact does not hold is missing', () => {
  const dist = tree({ 'index.html': page(''), 'manifest.json': MANIFEST });

  expect(scanReferences(dist).missing).toEqual(['manifest.json names icons/192.png']);
});

test('a stylesheet no page links is orphaned', () => {
  const dist = tree({
    'index.html': page('<link rel="stylesheet" href="src/main.css">'),
    'manifest.json': MANIFEST,
    'icons/192.png': '',
    'src/main.css': '',
    'src/pages/events.css': '',
  });

  expect(orphanedStylesheets(dist, scanReferences(dist).named)).toEqual(['src/pages/events.css']);
});

test('a file of a kind the site does not serve is refused', () => {
  const dist = tree({ 'index.html': '', 'tsconfig.tsbuildinfo': '', 'src/main.js.map': '' });

  expect(
    unservedFiles(dist, ['.html', '.js'])
      .map((path) => path.slice(dist.length + 1))
      .sort(),
  ).toEqual(['src/main.js.map', 'tsconfig.tsbuildinfo']);
});

test('a Git LFS pointer is found wherever it was copied, and a file that only mentions one is not', () => {
  const pointer = 'version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 1\n';
  const dist = tree({
    'index.html': '<p>version https://git-lfs.github.com/spec/v1</p>',
    'src/fixtures/a.png': pointer,
    'b.png': '\x89PNG',
  });

  expect(lfsPointers(dist).map((path) => path.slice(dist.length + 1))).toEqual(['src/fixtures/a.png']);
});

test('a *.ext entry takes the matching files of one directory, not of the ones beneath it', () => {
  const root = tree({ 'a.html': '', 'b.html': '', 'c.css': '', 'sub/d.html': '', 'data/e.json': '' });

  expect(expandEntry('*.html', root).sort()).toEqual(['a.html', 'b.html']);
  expect(expandEntry('data/*.json', root)).toEqual(['data/e.json']);
  expect(expandEntry('data', root)).toEqual(['data']);
});

test('a copy refuses to land on something the build already wrote', () => {
  const root = tree({ 'from.txt': 'new', 'dist/to.txt': 'old' });
  const dist = join(root, 'dist');

  expect(() => copyInto(dist, join(root, 'from.txt'), 'to.txt')).toThrow('which the build already wrote');
  expect(readFileSync(join(dist, 'to.txt'), 'utf8')).toBe('old');

  copyInto(dist, join(root, 'from.txt'), 'deep/to.txt');
  expect(readFileSync(join(dist, 'deep/to.txt'), 'utf8')).toBe('new');
});

test('VENDORED is the worker and the three cores, each a file installed under node_modules', () => {
  expect(Object.keys(VENDORED).sort()).toEqual(
    [
      'worker.min.js',
      'tesseract-core-lstm.wasm.js',
      'tesseract-core-relaxedsimd-lstm.wasm.js',
      'tesseract-core-simd-lstm.wasm.js',
    ]
      .map((name) => `${TESSERACT_VENDOR}${name}`)
      .sort(),
  );

  for (const from of Object.values(VENDORED)) {
    expect(existsSync(from), from).toBe(true);
  }
});
