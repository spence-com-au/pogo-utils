/**
 * Builds `ScreenPower.dex` out of the Java beside it in `src/tools/adb/screen-power/`, which `pnpm phone screen-off`
 * and `screen-on` run on the phone: `javac` from the JDK on the path, then D8, Android's own dex compiler, fetched once
 * from Google's Maven and held to its hash. The dex is committed, so that neither those commands nor the site's build
 * needs a JDK; `--check` builds it again and fails where it differs from what is committed, which is how CI holds the
 * two together.
 *
 * Usage: `node scripts/build-dex.mts [--check]`
 */

import { CACHE, cachedAs } from '../src/core/node/download.mts';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values: options } = parseArgs({ options: { check: { type: 'boolean', default: false } } });

const D8 = '8.13.25';
const D8_SHA256 = '0d4f2f68c4fcbc9434eff122f41feb6fb1d98efd2faa530cec1abacab1cea03d';

const source = fileURLToPath(new URL('../src/tools/adb/screen-power/ScreenPower.java', import.meta.url));
const dex = fileURLToPath(new URL('../src/tools/adb/screen-power/ScreenPower.dex', import.meta.url));

const jar = join(CACHE, 'd8', `r8-${D8}.jar`);
await cachedAs(
  join(CACHE, 'd8'),
  `r8-${D8}.jar`,
  `https://maven.google.com/com/android/tools/r8/${D8}/r8-${D8}.jar`,
  false,
  (bytes) => {
    if (createHash('sha256').update(bytes).digest('hex') !== D8_SHA256) {
      throw new Error(`not D8 ${D8}`);
    }
  },
);

const work = mkdtempSync(join(tmpdir(), 'build-dex-'));

try {
  // Java 8's class files, which join strings without the `invokedynamic` later releases use and D8 would rewrite;
  // `-Xlint:-options` hushes the JDK's warning that 8 is old.
  execFileSync('javac', ['--release', '8', '-Xlint:-options', '-d', work, source], { stdio: 'inherit' });

  // Android 8 and later, well short of any phone a battle has been played on.
  const d8 = ['-cp', jar, 'com.android.tools.r8.D8', '--release', '--min-api', '26'];
  execFileSync('java', [...d8, '--output', work, join(work, 'ScreenPower.class')], { stdio: 'inherit' });

  const built = readFileSync(join(work, 'classes.dex'));

  if (!options.check) {
    writeFileSync(dex, built);
  } else if (!built.equals(readFileSync(dex))) {
    console.error(`${dex} is not what ScreenPower.java builds to; run node scripts/build-dex.mts and commit it`);
    process.exitCode = 1;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
