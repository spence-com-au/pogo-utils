import { GAME_MASTER_CACHE, ICON_CACHE } from './download.mts';
import { encodePng } from './png.mts';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A working directory holding the cache `pnpm inventory` and `pnpm battle` would otherwise download, so a run of either
 * reaches no network. Their `CACHE` is relative, which is why this works at all: the directory a subprocess runs in
 * decides where its cache is, so no flag or stub is needed to move it.
 *
 * All three files are load-bearing, measured rather than reasoned about — seeded with the game master alone, a `pnpm
 * inventory parse` run prints two `Downloading` lines. Only its *contents* matter: `loadGameData` throws without a CP
 * multiplier for every level or without the power-up costs, where an empty icon index and string table it takes in its
 * stride. That emptiness is what lets a run's stderr be asserted — no form means no icon to fetch, so an empty stderr is
 * exactly the claim that the seeded cache was read rather than merely present.
 *
 * `extra` is appended to those templates for the tests that need a form to exist, and defaults to none so every other
 * caller keeps that emptiness. `icons` names what the index holds and writes each file beside it: the index is what
 * carries a name onto a form, deciding whether a family counts as drawn, and the files are what keep a drawn one off
 * the network. Their contents are arbitrary but they have to decode, an icon that does not being reported.
 */
export function reads(extra: readonly unknown[] = [], icons: readonly string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'cli-cache-'));
  const cache = join(dir, '.cache', 'inventory');
  const levels = Array.from({ length: 100 }, (_, i) => 0.1 + i / 100);

  mkdirSync(cache, { recursive: true });
  writeFileSync(
    join(cache, GAME_MASTER_CACHE),
    JSON.stringify([
      { templateId: 'PLAYER_LEVEL_SETTINGS', data: { playerLevel: { cpMultiplier: levels } } },
      {
        templateId: 'POKEMON_UPGRADE_SETTINGS',
        data: { pokemonUpgrades: { stardustCost: [], shadowStardustMultiplier: 1.2, purifiedStardustMultiplier: 0.9 } },
      },
      { templateId: 'LUCKY_POKEMON_SETTINGS', data: { luckyPokemonSettings: { powerUpStardustDiscountPercent: 0.5 } } },
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
