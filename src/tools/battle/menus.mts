/**
 * The screens between one Team Leader battle and the next, and where to tap on each to get from the result of one to
 * the start of the next: the result's ✓, the leader on the Battle tab, BATTLE under the leader's speech, the league,
 * then USE THIS PARTY on the game's recommended party. Training has no rematch, so this is the way round every time.
 * And the way in from the map: the Poké Ball, BATTLE on the main menu, and the Battle tab scrolled down from GO Battle
 * League, where it opens, to the Training card.
 *
 * Colour wherever it settles the question, being far cheaper than OCR and, on the game's own lettering, far surer: the
 * leaders' portraits, the two green buttons, the teal one at the foot of the screen and the map's Poké Ball. OCR for
 * the rest, which are told by words in plain capitals: the league's three lines, the main menu's labels and the Battle
 * tab's header. Positions are fractions of the screen; those that go through `layout.mts` are down as widths from their
 * anchors, which places them on any shape. Colours were measured on recorded frames of each screen and on full-size
 * screenshots.
 */

import { fold, ocr, type Line } from '../inventory/ocr.mts';
import { crop, rgb, type Image } from '../inventory/png.mts';
import { BOTTOM, down, place, tall, TOP } from './layout.mts';
import { cpsOf } from './party.mts';
import { type Point } from './play.mts';

export const LEADERS = ['blanche', 'candela', 'spark'] as const;
export type Leader = (typeof LEADERS)[number];

export const LEAGUES = ['great', 'ultra', 'master'] as const;
export type League = (typeof LEAGUES)[number];

/**
 * Which battles a run plays: Training against a leader in one of the three leagues, or GO Battle League in whichever of
 * its leagues and cups is on now, named by how its title starts — `ultra`, `master league: mega`, `fantasy cup`.
 */
export type Mode =
  | { mode: 'training'; leader: Leader; league: League }

  // `party` is the name of a party saved for the league, as its card is titled; none is whichever the screen opens on.
  | { mode: 'gbl'; league: string; party?: string };

/** Each Training league's CP cap, none being Master League's. */
export const CAPS: Readonly<Record<League, number | null>> = { great: 1500, ultra: 2500, master: null };

export type Menu =
  | { screen: 'map' | 'main' | 'training' | 'gbl' | 'welcome' | 'intro' | 'league' | 'result'; tap: Point }

  // The league's CP cap as GO Battle League's party screen states it: `null` for no limit, `undefined` where unread.
  // And the CP over each card, off the same read; Training's party screen is told by colour, and read for none.
  | { screen: 'party'; tap: Point; cap?: number | null; title?: string; cps?: (number | null)[] }
  | { screen: 'battle-tab' | 'league' | 'party'; swipe: readonly [Point, Point] }
  | { screen: 'matchmaking' | 'no-battle' | 'unknown' };

/**
 * The leaders' portraits on the Battle tab, found by colour rather than by name: OCR read the names under them as
 * `Blar I`, `indela` and `par!` off a full-size screenshot, and the `TRAINING` heading over them as `RAINI`. The card
 * moves with however the tab is scrolled, so it is looked for down the screen, as the row where Blanche's pale blue
 * backdrop — 184–196/235/246–249 — sits beside Candela's pink one — 224–237/156–165/163–169 — each sampled a little
 * left of the portrait's centre. Spark's is no help, the sample landing on her face or hair as often as her backdrop.
 */
const LEADER_X: Record<Leader, number> = { blanche: 0.26, candela: 0.5, spark: 0.74 };
const BLANCHE_BLUE = [190, 235, 247];
const CANDELA_PINK = [230, 160, 166];

/** How far below the backdrop's first row the portraits are tapped, near their centres, in widths. */
const PORTRAIT_BELOW = 0.0422;

/** Where on the screen the training card is looked for, as fractions of its height. */
const PORTRAIT_SEARCH = { from: 0.15, to: 0.95, step: 0.004 };

/**
 * BATTLE under the leader's speech, and USE THIS PARTY under the recommended party: the same green button, shaded from
 * yellowish on the left to teal on the right and lighter or darker with the capture. Measured from 103/207/144 to
 * 172/216/155 across recorded frames and full-size screenshots, so it is told by its shape — green well above red and
 * blue, blue in a narrow band — rather than held to one colour, which a screenshot of the party button missed by 28.
 */
const BATTLE: Point = [0.5, 0.4919];
const USE_PARTY: Point = [0.5, -0.0633];

/**
 * Where the two buttons are pinned. BATTLE was measured at 0.507 of the height, which is the middle to well within a
 * pixel. USE THIS PARTY was measured at 0.90: it sits on the party's panel, which stretches with the screen from where
 * its top is pinned, 0.565 down, to its foot.
 */
const BATTLE_ANCHOR = 0.5;
const USE_PARTY_ANCHOR = 0.9;

const isGreen = ([r, g, b]: readonly [number, number, number]) =>
  g >= 195 && g - r >= 25 && g - b >= 35 && r >= 90 && b >= 130 && b <= 175;

/** Whether the button is under `[x, y]`, sampled there and a little left of it, clear of the label. */
function green(image: Image, [x, y]: Point): boolean {
  return [x - 0.08, x].some((sx) => isGreen(rgb(image, sx * image.width, y * image.height)));
}

/**
 * Whether the row a button is on runs across a white card either side of it, at x 0.1 and 0.9. The colour alone does
 * not tell the two screens' buttons from others of the same green: the Battle tab draws GO Battle League's BATTLE in
 * it, inside a white card, and the map's grass passes it. So USE THIS PARTY is the one on a white panel, and BATTLE
 * under the leader's speech the one over the artwork — where GO Battle League's, at whatever height the tab is scrolled
 * to, is neither: on a card, above the ✗.
 *
 * Measured either side, on each fixture's button row: 248–249/252–254/237–240 on `menu-party` and `menu-party-full`,
 * from 4/6/6 to 92/73/57 on `menu-intro` and `menu-intro-spark`, 255/255/255 on `menu-unknown-battle-league`, and
 * 142/199/173 and 228/238/234 on `menu-unknown-map`.
 */
function panel(image: Image, y: number): boolean {
  return [0.1, 0.9].every((x) => {
    const [r, g, b] = rgb(image, x * image.width, y * image.height);

    return Math.min(r, g, b) >= 230 && Math.max(r, g, b) - Math.min(r, g, b) <= 16;
  });
}

/**
 * The round button at the foot of the screen: ✓ on the result, ✗ on the Battle tab and under the leader's speech. The ✗
 * closes the menu, so this is only ever tapped where nothing else has claimed the screen.
 *
 * Its teal is translucent, and only its red follows what is behind it: 27/132/146 over the result's forest and Blanche's
 * mountains, 64/131/146 over Spark's lit city. So green and blue are held to the teal, and red only kept low.
 */
const FOOT: Point = [0.5, -0.1372];

/**
 * How far above `FOOT` a tap is clear of the ✗, in widths, which floats over whatever the Battle tab has scrolled
 * beneath it: a Training card one scroll from its foot on a Pixel 8 Pro put Candela's portrait under it.
 */
const CLEAR_OF_FOOT = 0.0844;

function teal(image: Image): boolean {
  const [r, g, b] = rgb(image, FOOT[0] * image.width, down(FOOT[1], BOTTOM, image) * image.height);

  return r < 100 && Math.abs(g - 132) <= 15 && Math.abs(b - 146) <= 15;
}

/**
 * The map's Poké Ball, which opens the main menu: its red top and white bottom either side of the grey centre, measured
 * at 235/76/78 and 255/56/69 above and 253–255 all three below on two maps. Nothing else is drawn red there.
 */
const BALL: Point = [0.5, -0.1436];

function pokeBall(image: Image): boolean {
  const [x, y] = place(BALL, BOTTOM, image);
  const [r, g, b] = rgb(image, x * image.width, (y - tall(0.0422, image)) * image.height);
  const below = rgb(image, x * image.width, (y + tall(0.0486, image)) * image.height);

  return r >= 200 && g <= 110 && b <= 110 && below.every((c) => c >= 240);
}

/** How far below its label the main menu's BATTLE is tapped, at the centre of its circle, in widths. */
const LABEL_ABOVE = 0.1267;

/**
 * The Battle tab's scroll, up its middle: from GO Battle League, where it opens, towards the Training card at its foot.
 * Slow enough to be a drag rather than a tap on whatever it starts over, and short of the ✗.
 */
const SCROLL: readonly [Point, Point] = [
  [0.5, 0.75],
  [0.5, 0.35],
];

/**
 * The Battle tab's header, BATTLE and PARTY, in the band at the top of the screen, as widths down from it. Either word
 * will do, OCR having read only BATTLE off a Pixel 8 Pro's, the unselected PARTY being grey on the teal; nothing else
 * draws BATTLE that high, the main menu's being halfway down and the leader's BATTLE three quarters.
 */
const HEADER = 0.2111;

/**
 * The main menu's other labels, any two of which beside BATTLE make it the main menu: OCR has missed ITEMS where
 * PGSharp's toolbar was open down the screen's left edge, and the Battle tab draws none of them.
 */
const MAIN_LABELS = ['pokedex', 'pokemon', 'shop', 'items'];

const centre = (line: Line, image: Image): Point => [
  (line.left + line.width / 2) / image.width,
  (line.top + line.height / 2) / image.height,
];

const matches = (image: Image, x: number, y: number, colour: readonly number[]) =>
  rgb(image, x * image.width, y * image.height).every((c, i) => Math.abs(c - (colour[i] ?? 0)) <= 20);

/** The first row, down the screen, where Blanche's backdrop sits beside Candela's; `undefined` off the Battle tab. */
function portraits(image: Image): number | undefined {
  for (let y = PORTRAIT_SEARCH.from; y < PORTRAIT_SEARCH.to; y += PORTRAIT_SEARCH.step) {
    if (
      matches(image, LEADER_X.blanche - 0.025, y, BLANCHE_BLUE) &&
      matches(image, LEADER_X.candela - 0.025, y, CANDELA_PINK)
    ) {
      return y;
    }
  }

  return undefined;
}

/**
 * GO Battle League's BATTLE, on its card at the top of the Battle tab: the first run of the buttons' green down the
 * card from its heading, sampled left of the label, which OCR reads only as `GO BATTLE LEAGUE` above and `3/5 battles
 * played` below it. Measured at 122/202/152 on a Pixel 4 XL's full-size screenshot. A run shorter than `BUTTON` is a
 * speck of the same green in the reward track's artwork. Tapped where it was sampled rather than at its middle: before a
 * set, with a line more on the card, the button sits low enough that the ✗ covers its middle.
 */
const GBL_BUTTON_X = 0.3;
const BUTTON = 0.02;

function buttonBelow(image: Image, line: Line): Point | undefined {
  let top: number | undefined;

  for (let y = (line.top + line.height) / image.height; y < 1; y += 0.002) {
    const lit = isGreen(rgb(image, GBL_BUTTON_X * image.width, y * image.height));

    if (lit) {
      top ??= y;
    } else if (top !== undefined && y - top >= BUTTON) {
      return [GBL_BUTTON_X, (top + y) / 2];
    } else {
      top = undefined;
    }
  }

  return undefined;
}

/**
 * LET'S GO! on the welcome GO Battle League shows before a set, between the card's BATTLE and the league chooser: the
 * buttons' green on a white panel, as USE THIS PARTY is, at 0.865 to 0.925 of the height to the party button's 0.87, so
 * only its words tell it from the party. Found under them the way the card's BATTLE is.
 */
function welcomeButton(image: Image, lines: readonly Line[]): Point | undefined {
  const title = lines.find((line) => fold(line.text).startsWith('welcome to the go'));

  return title && buttonBelow(image, title);
}

const MAX_CP = 'max cp per pokemon';

/**
 * The title of the party in front on GO Battle League's party screen, a carousel of the league's saved parties: its
 * name, centred on the card a line or two under `CHOOSE YOUR PARTY` — `test 4` 0.068 under it on a Pixel 8 Pro, `gbl`
 * 0.070. Folded as OCR read it, the league's badge beside it sometimes run on, `pgs recommended battle party v`, so it is
 * matched by its words rather than whole. `undefined` where the heading or the title went unread.
 */
const TITLE_BELOW = { least: 0.03, most: 0.1 } as const;

function partyTitle(lines: readonly Line[], image: Image): string | undefined {
  const heading = lines.find((line) => fold(line.text) === 'choose your party');

  if (!heading) {
    return undefined;
  }

  const title = lines.find((line) => {
    const below = (line.top - heading.top) / image.height;
    const [x] = centre(line, image);

    return below >= TITLE_BELOW.least && below <= TITLE_BELOW.most && x > 0.35 && x < 0.65;
  });

  return title && fold(title.text);
}

/** Whether the party titled `title`, as `partyTitle` read it, is the one named `name`: its words, whole, in order. */
export const isParty = (title: string, name: string) => ` ${title} `.includes(` ${fold(name)} `);

/** Where a search of the party carousel has got to: the way it is going, and the titles it has passed. */
export interface Carousel {
  way: 'next' | 'back';
  turned: boolean;
  seen: string[];
  steps: number;
}

export const carousel = (): Carousel => ({ way: 'next', turned: false, seen: [], steps: 0 });

/**
 * How many swipes a search of the carousel takes at most: there and back across a dozen parties. Its ends are what
 * stop it otherwise, and a title misread differently swipe after swipe would never show one.
 */
const CAROUSEL_STEPS = 24;

/**
 * What to do next about the party carousel showing `title`, to use the party named `name`: use it, swipe on, or wait for
 * a read that names it. The search goes one way until a swipe leaves the same party in front — that end of the carousel
 * — then the other, and throws, naming the parties it passed, once both ends are reached without it: a party the run
 * was told to use and cannot find is no reason to battle with another.
 */
export function searchParty(
  search: Carousel,
  title: string | undefined,
  name: string,
): 'use' | 'next' | 'back' | 'unread' {
  if (title === undefined) {
    return 'unread';
  }

  if (isParty(title, name)) {
    return 'use';
  }

  if ((search.seen.at(-1) === title && search.turned) || search.steps >= CAROUSEL_STEPS) {
    throw new Error(`no party named ${name} saved for this league: ${search.seen.join(', ')}`);
  }

  search.steps++;

  if (search.seen.at(-1) === title) {
    search.turned = true;
    search.way = search.way === 'next' ? 'back' : 'next';
  } else {
    search.seen.push(title);
  }

  return search.way;
}

/**
 * Swipes along the party carousel, a card at a time across the cards, which are pinned at 0.69 of the height: towards
 * the parties after the one in front, and back towards those before it.
 */
export const CAROUSEL: Readonly<Record<'next' | 'back', readonly [Point, Point]>> = {
  next: [
    [0.85, 0.72],
    [0.15, 0.72],
  ],
  back: [
    [0.15, 0.72],
    [0.85, 0.72],
  ],
};

/**
 * The CP cap GO Battle League's party screen states under the league's name, `Max CP per Pokémon: 2,500` or `No
 * limit`, which OCR reads as `max cp per pokemon 2 500` and the cup's own title would not give: `fantasy cup` says
 * nothing of a cap, `Great League Edition` only where the title runs on. `undefined` where the line went unread.
 */
function capOf(lines: readonly Line[]): number | null | undefined {
  const line = lines.map((each) => fold(each.text)).find((text) => text.startsWith(MAX_CP));
  const stated = line?.slice(MAX_CP.length).trim();

  if (stated === 'no limit') {
    return null;
  }

  const cap = Number(stated?.replaceAll(' ', ''));

  return Number.isInteger(cap) && cap > 0 ? cap : undefined;
}

/** The Battle tab's scroll the other way, back up to GO Battle League's card at its top. */
const SCROLL_UP: readonly [Point, Point] = [SCROLL[1], SCROLL[0]];

/**
 * GO Battle League's NEXT BATTLE on its result, the buttons' green over the artwork, above the ✓ and pinned with it to
 * the screen's foot: 131/204/149 at 0.854 of a Pixel 4 XL's height.
 */
const NEXT_BATTLE: Point = [0.5, -0.3082];

/**
 * The Battle tab's cards below GO Battle League's, the tab's header having gone unread off one scrolled down to them.
 * Nearby Battle's heading reads where Training's does not.
 */
const LOWER_CARDS = ['nearby battle'];

/** What GO Battle League shows while it finds an opponent, before the battle's first frame. */
const MATCHMAKING = ['finding opponent', 'battle starting'];

/**
 * The league chooser's list, scrolled from where it opens — at the league last played, which can leave the first
 * cards above the screen — back down to its top.
 */
const LIST_TO_TOP: readonly [Point, Point] = [
  [0.5, 0.42],
  [0.5, 0.85],
];

/**
 * Where a card's title is, as fractions of the screen: right of its league's badge, which OCR reads as litter, and no
 * more than its two lines above its `Max CP per Pokémon`, the blurred backdrop above the first card reading as litter
 * too.
 */
const TITLE_LEFT = 0.33;
const TITLE_ABOVE = 0.1;

/**
 * The leagues GO Battle League offers now, each card's title — over one line or two — above its `Max CP per Pokémon`
 * line, and above `SEE WHAT'S COMING NEXT`, under which the next ones are listed faded. Answers each title with where
 * to tap it, or `undefined` off the chooser. Any of the three is the chooser, OCR having read neither the heading nor
 * the line under the leagues on now off one scrolled part way down, and the recommended party's `Max CP per Pokémon`
 * being told by its button before this is asked.
 */
function gblLeagues(lines: readonly Line[], image: Image): { title: string; tap: Point }[] | undefined {
  const folded = lines.map((line) => ({ line, text: fold(line.text) }));
  const header = folded.find(({ text }) => text === 'choose your league');
  const upcoming = folded.find(({ text }) => text.startsWith('see what s coming next'));

  const caps = folded.filter(
    ({ line, text }) => text.startsWith(MAX_CP) && (!upcoming || line.top < upcoming.line.top),
  );

  if (!header && !upcoming && caps.length === 0) {
    return undefined;
  }

  return caps.flatMap(({ line: cap }, i) => {
    const above = caps[i - 1]?.line.top ?? header?.line.top ?? 0;
    const title = folded.filter(
      ({ line, text }) =>
        line.top > Math.max(above, cap.top - TITLE_ABOVE * image.height) &&
        line.top < cap.top &&
        line.left >= TITLE_LEFT * image.width &&
        !/^(max cp|limited selection|choose your league)/.test(text),
    );
    const [first] = title;

    return first ? [{ title: title.map(({ text }) => text).join(' '), tap: centre(first.line, image) }] : [];
  });
}

/**
 * Whether `image` shows USE THIS PARTY on the party's white panel, with no ✗ at the foot: the party screen, or the
 * welcome before a GO Battle League set, which only its words tell apart.
 */
export function onParty(image: Image): boolean {
  const party = place(USE_PARTY, USE_PARTY_ANCHOR, image);

  return green(image, party) && panel(image, party[1]) && !teal(image);
}

/**
 * Which screen `image` is, and where to tap on it for the `mode`'s battles. `read` is the OCR, which is only asked for
 * where colour cannot answer. Training's screens are never looked for in GO Battle League, nor its screens in Training:
 * a portrait scrolled into view on the Battle tab is not to be tapped for GO Battle League.
 *
 * `result` says whether a battle has ended with its ✓ not yet tapped, which is the only time the teal button at the foot
 * is read as the result's. Anywhere else it is the ✗ that closes the menu, and a Battle tab whose portraits were not
 * found would otherwise have been taken for the result and closed.
 *
 * Throws where the GO Battle League chooser lists leagues and none is the one asked for.
 */
export async function readMenu(
  image: Image,
  { result, ...mode }: Mode & { result: boolean },
  read: (image: Image) => Promise<Line[]> = ocr,
): Promise<Menu> {
  const fight = place(BATTLE, BATTLE_ANCHOR, image);
  const party = place(USE_PARTY, USE_PARTY_ANCHOR, image);
  const foot = place(FOOT, BOTTOM, image);
  const training = mode.mode === 'training';

  if (training && green(image, fight) && teal(image) && !panel(image, fight[1])) {
    return { screen: 'intro', tap: fight };
  }

  if (onParty(image)) {
    if (training) {
      return { screen: 'party', tap: party };
    }

    const lines = await read(image);
    const welcome = welcomeButton(image, lines);

    if (welcome) {
      return { screen: 'welcome', tap: welcome };
    }

    const title = partyTitle(lines, image);

    return { screen: 'party', tap: party, cap: capOf(lines), cps: cpsOf(lines, image), ...(title && { title }) };
  }

  if (pokeBall(image)) {
    return { screen: 'map', tap: place(BALL, BOTTOM, image) };
  }

  const row = training ? portraits(image) : undefined;
  const portrait = row === undefined ? undefined : row + tall(PORTRAIT_BELOW, image);

  // A card found under the ✗ is scrolled up clear of it rather than tapped, which would close the menu.
  if (training && portrait !== undefined && portrait > foot[1] - tall(CLEAR_OF_FOOT, image)) {
    return { screen: 'battle-tab', swipe: SCROLL };
  }

  if (training && portrait !== undefined) {
    return { screen: 'training', tap: [LEADER_X[mode.leader], portrait] };
  }

  const lines = await read(image);
  const words = (word: string) => lines.filter((line) => fold(line.text) === word);

  if (training) {
    const leagues = lines.filter((line) => /^(great|ultra|master) league$/.test(fold(line.text)));
    const chosen = leagues.find((line) => fold(line.text) === `${mode.league} league`);

    if (leagues.length >= 2 && chosen) {
      return { screen: 'league', tap: centre(chosen, image) };
    }
  } else {
    const offered = gblLeagues(lines, image);

    if (offered) {
      const wanted = fold(mode.league);
      const chosen = offered.filter(({ title }) => title.startsWith(wanted));

      if (chosen.length > 1) {
        throw new Error(`--league ${mode.league} is more than one league: ${chosen.map((l) => l.title).join('; ')}`);
      }

      if (chosen[0]) {
        return { screen: 'league', tap: chosen[0].tap };
      }

      // The heading over the first card read, and none is the one: the list is the leagues on now from its top, and it
      // is not among them. Without the heading the list may have opened part way down, the one asked for above it.
      if (offered.length > 0 && lines.some((line) => fold(line.text) === 'choose your league')) {
        throw new Error(`--league ${mode.league} is not on now: ${offered.map((l) => l.title).join('; ')}`);
      }

      return { screen: 'league', swipe: LIST_TO_TOP };
    }

    if (lines.some((line) => MATCHMAKING.some((text) => fold(line.text).startsWith(text)))) {
      return { screen: 'matchmaking' };
    }
  }

  const [battle] = words('battle');

  if (battle && MAIN_LABELS.filter((label) => words(label).length > 0).length >= 2) {
    const [x, y] = centre(battle, image);

    return { screen: 'main', tap: [x, y + tall(LABEL_ABOVE, image)] };
  }

  if ([...words('battle'), ...words('party')].some((line) => centre(line, image)[1] < down(HEADER, TOP, image))) {
    if (training) {
      return { screen: 'battle-tab', swipe: SCROLL };
    }

    const [heading] = words('go battle league');
    const button = heading && buttonBelow(image, heading);

    if (button) {
      return { screen: 'gbl', tap: button };
    }

    // The card with its BATTLE greyed out: a reward to collect, the encounter among them, and no battle until it is.
    return heading ? { screen: 'no-battle' } : { screen: 'battle-tab', swipe: SCROLL_UP };
  }

  if (!training && LOWER_CARDS.some((card) => words(card).length > 0)) {
    return { screen: 'battle-tab', swipe: SCROLL_UP };
  }

  if (result && teal(image)) {
    const next = place(NEXT_BATTLE, BOTTOM, image);

    return { screen: 'result', tap: !training && green(image, next) ? next : foot };
  }

  return { screen: 'unknown' };
}

/**
 * The band the result's verdict is lettered across, mid-screen, as fractions of the screen's height: `YOU WIN!` on one
 * line or `GOOD EFFORT!` on two, from 0.43 to 0.61 at most across a Pixel 4 XL's frames and screenshots and a Pixel 8
 * Pro's frame.
 */
const VERDICT = { top: 0.38, bottom: 0.65 } as const;

/**
 * How bright each channel of the verdict's white lettering is at least. OCR reads none of the six committed results as
 * they are, the letters lost in the trees and the avatar behind them; kept to only what is this white, it reads all six
 * at any threshold from 215 to 250.
 */
const LETTERING = 235;

export type Outcome = 'won' | 'lost';

/** What the result on `image` says of the battle: won for `YOU WIN!`, lost for `GOOD EFFORT!`, or neither. */
export async function readOutcome(image: Image): Promise<Outcome | undefined> {
  const top = Math.round(VERDICT.top * image.height);
  const band = crop(image, 0, top, image.width, Math.round(VERDICT.bottom * image.height) - top);

  // Black on white, as Tesseract reads best: the lettering's white, and nothing else.
  for (let i = 0; i < band.data.length; i += 4) {
    const white = Math.min(band.data[i] ?? 0, band.data[i + 1] ?? 0, band.data[i + 2] ?? 0) >= LETTERING;
    band.data.fill(white ? 0 : 255, i, i + 4);
    band.data[i + 3] = 255;
  }

  const text = (await ocr(band)).map((line) => fold(line.text)).join(' ');

  return /\bwin\b/.test(text) ? 'won' : /\beffort\b/.test(text) ? 'lost' : undefined;
}
