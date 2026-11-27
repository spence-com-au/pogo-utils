/**
 * The run finding its way to a battle and back: the Battle tab, results, the leader, the party carousel and the
 * selection screen.
 */

import { type Image } from '../../core/png.mts';
import { readCps } from './party.mts';
import { type Point } from './layout.mts';
import { GAME_ALONE } from './overlay.mts';
import { Lost, LOST_MS } from './run.mts';
import {
  battleAndBack,
  fixture,
  GBL,
  ICONS,
  league,
  MASTER_CP_UNREAD,
  masterParty,
  painted,
  play,
  recorder,
  type Scene,
  scripted,
  SELECTION,
  ULTRA,
} from './node/test-run.mts';
import { expect, test } from 'vitest';

// The party screen is tapped twice: its first card, for a selection screen these scenes never open, and USE THIS PARTY.
test('plays a battle from the Battle tab and taps its way back round', async () => {
  const { phone, clock, taps } = scripted(battleAndBack(), 'training');

  const battles = await play(phone, { mode: ULTRA, count: 1 }, clock);

  expect(battles).toEqual({ battles: 1, won: 1, lost: 0 });
  expect(taps).toEqual(['training', 'intro', 'league', 'party', 'party', 'charged', 'result']);
});

// The demo clip's first frame of its result, the ✓ drawn and the verdict still fading in, caught by a read as #610 saw
// it: read again rather than counted unread. It lasts long enough for one read to land on it, as a single frame can.
test('reads a result again whose verdict is still fading in', async () => {
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      won: {
        frame: fixture('other-win'),
        screenshot: fixture('menu-unknown-medal'),
        lasts: { ms: 8000, to: 'fading' },
      },
      fading: { frame: fixture('menu-result-fading'), lasts: { ms: 300, to: 'result' } },
    },
    'training',
  );

  expect(await play(phone, { mode: ULTRA, count: 1 }, clock)).toEqual({ battles: 1, won: 1, lost: 0 });
});

/**
 * PGSharp's star low at the left edge of a Pixel 4 XL, as `uiautomator dump` would write it: clear of everything read,
 * but over where the minigame's fourth row is swept from, x 0.05 at y 0.76. Lower, by the last row's, it lies over the
 * ring a Mega's left button reads beyond its rim.
 */
const STAR_LOW = GAME_ALONE.replace(
  '</hierarchy>',
  '<node index="1" text="" resource-id="me.underw.hp:id/hl_floating_icon" class="android.widget.ImageView" ' +
    'package="com.nianticlabs.pokemongo" content-desc="" bounds="[0,2247][126,2373]" /></hierarchy>',
);

// With no type icons the bubbles' colour is unknown, and the minigame is swept row by row, from the star's end too.
test('swipes around PGSharp’s star, never beginning a swipe on it', async () => {
  const scenes = Object.fromEntries(
    Object.entries(battleAndBack()).map(([name, scene]) => [name, { ...scene, views: STAR_LOW }]),
  );
  const { phone, clock, strokes } = scripted(scenes, 'training');
  const star = { left: 0, top: 2247 / 3040, right: 126 / 1440, bottom: 2373 / 3040 };
  const on = ([x, y]: Point) => x <= star.right + 0.03 && y >= star.top - 0.015 && y <= star.bottom + 0.015;

  expect(await play(phone, { mode: ULTRA, typeIcons: {}, count: 1 }, clock)).toEqual({ battles: 1, won: 1, lost: 0 });
  expect(strokes.filter(({ from }) => on(from))).toEqual([]);
  expect(strokes.filter(({ to }) => on(to)).length).toBeGreaterThan(0);
});

// A result left over from a battle before the run, as one stopped mid-fight leaves, is tapped past and not counted.
test('taps past a result it started on, then plays the battle counted', async () => {
  const { phone, clock, taps } = scripted(battleAndBack(), 'result');

  const battles = await play(phone, { mode: ULTRA, count: 1 }, clock);

  expect(battles).toEqual({ battles: 1, won: 1, lost: 0 });
  expect(taps).toEqual(['result', 'training', 'intro', 'league', 'party', 'party', 'charged', 'result']);
});

/**
 * `menu-result` as the game fades it in, its ✓ teal already but `YOU WIN!` still too faint to read: each channel of the
 * verdict's band at 80%, its white at 204, short of what `readOutcome` takes for lettering. The demo battle's first
 * frame of its result is drawn so, the verdict half faded in over the ✓ at full colour.
 */
function fadingIn(result: Image): Image {
  const data = result.data.slice();
  const [from, to] = [0.38, 0.65].map((y) => Math.round(y * result.height) * result.width * 4);

  for (let i = from ?? 0; i < (to ?? 0); i += 4) {
    data[i] = Math.round((data[i] ?? 0) * 0.8);
    data[i + 1] = Math.round((data[i + 1] ?? 0) * 0.8);
    data[i + 2] = Math.round((data[i + 2] ?? 0) * 0.8);
  }

  return { ...result, data };
}

// A result screenshot as it fades in is looked at again rather than counted unread, as the demo battle's was (#610).
test('reads the verdict of a result screenshot as it fades in', async () => {
  const { phone, clock } = scripted(
    {
      ...battleAndBack(),
      won: {
        frame: fixture('other-win'),
        screenshot: fixture('menu-unknown-medal'),
        lasts: { ms: 8000, to: 'fading' },
      },
      fading: { frame: fadingIn(fixture('menu-result')), lasts: { ms: 1000, to: 'result' } },
    },
    'training',
  );
  const report = recorder();

  expect(await play(phone, { mode: ULTRA, count: 1 }, clock, report)).toEqual({ battles: 1, won: 1, lost: 0 });
  expect(report.events).toContain('run: battle 1 won');
});

/** The map's Poké Ball, BATTLE on the main menu, and the Battle tab scrolled from GO Battle League to Training. */
test('finds its way to the leader from the map', async () => {
  const { phone, clock, taps } = scripted(
    {
      ...battleAndBack(),
      map: { frame: fixture('menu-map'), tap: { at: [0.5, 0.932], to: 'main' } },
      main: { frame: fixture('menu-main'), tap: { at: [0.777, 0.5975], to: 'tab' } },
      tab: { frame: fixture('menu-battle-league'), swipes: { count: 1, to: 'training' } },
    },
    'map',
  );

  expect(await play(phone, { mode: ULTRA, count: 1 }, clock)).toEqual({ battles: 1, won: 1, lost: 0 });
  expect(taps.slice(0, 3)).toEqual(['map', 'main', 'training']);
});

/**
 * Ultra League's carousel on a Pixel 8 Pro, opening on Test 4 with Test 3 and GBL after it: the party named is swiped
 * to, and only then used, and one not saved stops the run rather than battle with another.
 */
function parties(): Record<string, Scene> {
  return {
    ...league(),
    party: { frame: fixture('menu-pixel8-party-test4'), swipes: { count: 1, to: 'test3' } },
    test3: { frame: fixture('menu-pixel8-party-test3'), swipes: { count: 1, to: 'gbl' } },
    gbl: { frame: fixture('menu-pixel8-party-gbl'), tap: { at: [0.5, 0.87], to: 'matching' } },
  };
}

test('swipes the party carousel to the party named before using it', async () => {
  const { phone, clock, taps, strokes } = scripted(parties(), 'party');

  expect(await play(phone, { mode: { ...GBL, party: 'GBL' }, count: 1 }, clock)).toEqual({
    battles: 1,
    won: 0,
    lost: 1,
  });
  expect(strokes.filter(({ scene }) => scene === 'party' || scene === 'test3')).toHaveLength(2);
  expect(taps.slice(0, 1)).toEqual(['gbl']);
});

// Eight swipes before the party, some 25s of swipes, settles and reads: longer than `LOST_MS`, and not lost for it.
test('searches a carousel for longer than the run takes to give up as lost', async () => {
  const cards = ['menu-pixel8-party-test4', 'menu-pixel8-party-test3'];
  const walk = Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [
      `card${i}`,
      { frame: fixture(cards[i % 2] ?? ''), swipes: { count: 1, to: i === 7 ? 'gbl' : `card${i + 1}` } },
    ]),
  );
  const { phone, clock, taps } = scripted({ ...parties(), ...walk }, 'card0');

  expect(await play(phone, { mode: { ...GBL, party: 'GBL' }, count: 1 }, clock)).toEqual({
    battles: 1,
    won: 0,
    lost: 1,
  });
  expect(taps[0]).toBe('gbl');
  expect(clock.now()).toBeGreaterThan(LOST_MS);
});

test('stops rather than battle where no party has the name', async () => {
  const { phone, clock, taps } = scripted(parties(), 'party');

  await expect(play(phone, { mode: { ...GBL, party: 'Great' }, count: 1 }, clock)).rejects.toThrow(
    'no party named Great saved for this league: test 4, test 3, gbl',
  );
  expect(taps).toEqual([]);
});

/** The committed icons with Palkia's outlines taken for Mamoswine's, so as to misread Palkia's card. */
const MISREAD = ICONS.map((icon) => (icon.species === 'Palkia' ? { ...icon, species: 'Mamoswine' } : icon));

// The second time round, Xerneas's CP unread, its card is still the one read: none is read again.
test('reads each card’s moves off the selection screen before using the party, and only once', async () => {
  const { phone, clock, taps, holds, searches } = scripted(masterParty(), 'party');
  const report = recorder();

  expect(await readCps(MASTER_CP_UNREAD)).toEqual([4673, 3986, null]);
  expect(await play(phone, { mode: ULTRA, icons: MISREAD, count: 2 }, clock, report)).toEqual({
    battles: 2,
    won: 2,
    lost: 0,
  });
  expect(
    report.events.filter((line) => line.startsWith('run: party: M') || /^run: .*( CP \d|unread)/.test(line)),
  ).toEqual([
    'run: party: Mamoswine, Metagross, Xerneas',
    'run: Palkia CP 4673: Dragon Breath / Spacial Rend, Aqua Tail',
    'run: card 2 unread: no pink cell for 376&cp3986 or cp3986',
    'run: Xerneas CP 4275: Geomancy / Moonblast, Close Combat',
    'run: party: Mamoswine, Metagross, Xerneas',
  ]);
  expect(searches).toEqual(['473&cp4673', 'cp4673', '376&cp3986', 'cp3986', '716&cp4275']);
  expect(holds).toEqual(['found0', 'found2']);
  expect(taps.filter((scene) => scene === 'party' || scene === 'again')).toEqual([
    ...['party', 'party', 'party', 'party'],
    'again',
  ]);
});

// Palkia's card, its silhouette read as Mamoswine, found by its CP alone, and its panel with Water painted out: no
// form that is Dragon alone holds Spacial Rend, so the panel names nobody, and Mamoswine, which the search by its dex
// number ruled out, is not put back.
test('names nobody a card its CP alone found where its panel names nobody', async () => {
  const scenes = masterParty();
  const blanked = painted(fixture('menu-pixel8-held-palkia'), [255, 255, 255], [0.085, 0.38, 0.235, 0.45]);
  const { phone, clock } = scripted(
    {
      ...scenes,
      found0: {
        ...scenes.found0,
        frame: fixture('menu-pixel8-search-palkia'),
        hold: { at: SELECTION.first, shows: blanked },
      },
    },
    'party',
  );
  const report = recorder();

  await play(phone, { mode: ULTRA, icons: MISREAD, count: 1 }, clock, report);

  expect(report.events.filter((line) => /^run: .* CP 4673/.test(line))).toEqual([
    'run: ? CP 4673: Dragon Breath / Spacial Rend, Aqua Tail',
  ]);
});

/**
 * Xerneas's CP unread the first time round, so its card is passed over untried, and read the second time, its CP read:
 * Palkia, read, and Metagross, tried and not read, are not tried again.
 */
test('tries a card passed over for its CP once its CP is read', async () => {
  const { phone, clock, searches } = scripted(
    { ...masterParty(), league: { frame: fixture('menu-league'), tap: { at: [0.55, 0.58], to: 'party' } } },
    'again',
  );
  const report = recorder();

  expect(await play(phone, { mode: ULTRA, icons: MISREAD, count: 2 }, clock, report)).toEqual({
    battles: 2,
    won: 2,
    lost: 0,
  });
  expect(report.events.filter((line) => /^run: .*( CP \d|unread)/.test(line))).toEqual([
    'run: Palkia CP 4673: Dragon Breath / Spacial Rend, Aqua Tail',
    'run: card 2 unread: no pink cell for 376&cp3986 or cp3986',
    'run: card 3 unread: its CP unread',
    'run: Xerneas CP 4275: Geomancy / Moonblast, Close Combat',
  ]);
  expect(searches).toEqual(['473&cp4673', 'cp4673', '376&cp3986', 'cp3986', '716&cp4275']);
});

// The selection screen 2s behind Palkia's card's tap, as a phone at work can draw it: looked for again, and read.
test('reads a card whose selection screen opens late', async () => {
  const { phone, clock, holds } = scripted(
    {
      ...masterParty(),
      party: {
        frame: fixture('menu-pixel8-party-master'),
        tap: [
          { at: SELECTION.card(0), to: 'opening' },
          { at: SELECTION.card(1), to: 'select1' },
          { at: SELECTION.card(2), to: 'select2' },
          { at: SELECTION.use, to: 'loading' },
        ],
      },
      opening: { frame: fixture('menu-pixel8-party-master'), lasts: { ms: 2000, to: 'select0' } },
    },
    'party',
  );

  expect(await play(phone, { mode: ULTRA, icons: MISREAD, count: 1 }, clock)).toEqual({
    battles: 1,
    won: 1,
    lost: 0,
  });
  expect(holds).toEqual(['found0', 'found2']);
});

/**
 * CANCEL tapped and the selection screen still showing, as where the tap missed: USE THIS PARTY falls on its grid,
 * where a tap swaps the Pokémon there into the party, so nothing more is tapped, and the screen nothing recognises ends
 * the run `Lost`. Here a tap there starts the battle, so tapping it would play one rather than end lost.
 */
test('taps nothing more where CANCEL leaves the selection screen showing', async () => {
  const { phone, clock } = scripted(masterParty({ at: SELECTION.use, to: 'loading' }), 'party');

  await expect(play(phone, { mode: ULTRA, icons: MISREAD, count: 1 }, clock)).rejects.toBeInstanceOf(Lost);
});
