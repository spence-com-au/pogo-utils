/**
 * Which part of a battle a frame shows, out of colour samples alone: cheap enough to ask of every frame at 30 a second,
 * which OCR is not. Every position across is a fraction of the frame's width and every position down is widths of it
 * from an anchor, placed on a frame of any size or shape as `layout.mts` places it. Every threshold was measured on 935
 * frames of Team Leader battles recorded off a Pixel 4 XL — quoted beside it, so that a threshold that stops working
 * can be checked against what it was set from.
 *
 * Screens that are not a battle — the result, the menus between battles, the fades — are all `other`, for a caller to
 * read with OCR once the screen has settled.
 */

import { chroma, luminance, median, rgb, type Image } from '../../core/png.mts';
import { around, BOTTOM, down, spanning, TOP, type AnchoredBox, type Area, type Size } from './layout.mts';
import { type Colour } from './minigame.mts';

/**
 * - `battle`: the fight, with no charged move ready.
 * - `charged`: the fight, with a charged move ready to throw.
 * - `playing`: the HUD up but none of our charged-move buttons drawn, so no fast move fires: a charged move under way,
 *   from the tap that throws it or the opponent's throw, through its banner, `Get Ready!`, the minigame and the move
 *   playing out; a Pokémon fainting, and the next flying in.
 * - `shield`: the prompt offering a Protect Shield against an incoming charged move.
 * - `switch`: the prompt choosing the next Pokémon after one has fainted.
 * - `other`: anything else.
 */
export type State = 'battle' | 'charged' | 'playing' | 'shield' | 'switch' | 'other';

/** Where a box `top` to `bottom` widths from `anchor` runs down `image`, in pixels. */
const rows = (image: Image, top: number, bottom: number, anchor: number) =>
  [down(top, anchor, image), down(bottom, anchor, image)].map((y) => Math.round(y * image.height)) as [number, number];

function* pixels(image: Image, [left, top, right, bottom]: AnchoredBox, anchor: number): Generator<Colour> {
  const [from, to] = rows(image, top, bottom, anchor);

  for (let y = from; y < to; y++) {
    for (let x = Math.round(left * image.width); x < Math.round(right * image.width); x++) {
      yield rgb(image, x, y);
    }
  }
}

function mean(image: Image, box: AnchoredBox, anchor: number): Colour {
  let [r, g, b, n] = [0, 0, 0, 0];

  for (const [red, green, blue] of pixels(image, box, anchor)) {
    r += red;
    g += green;
    b += blue;
    n++;
  }

  n = Math.max(n, 1);

  return [r / n, g / n, b / n];
}

/** Each channel's median over a box: the colour of whatever covers most of it, deaf to what covers the rest. */
function medianColour(image: Image, box: AnchoredBox, anchor: number): Colour {
  const channels: [number[], number[], number[]] = [[], [], []];

  for (const colour of pixels(image, box, anchor)) {
    colour.forEach((level, i) => channels[i]?.push(level));
  }

  return channels.map(median) as unknown as Colour;
}

const near = (colour: Colour, target: Colour, within: number) =>
  colour.every((channel, i) => Math.abs(channel - (target[i] ?? 0)) <= within);

/**
 * Strips of the two panels across the top of a battle, beside each player's CP, and the line above them that holds
 * each side's name and CP.
 *
 * The panels are white at about 80% opacity, so each takes a fifth of its colour from what is behind it: 244/251/251
 * under cloud, 229/244/252 under a deep blue sky and 207/216/230 under a night one, which a 19/59/140 gap between them
 * predicts. So no channel falls below 195 and the chroma stays under 52 — a fifth of the most anything behind could
 * have. Not always a sky: a Galarian Moltres's magenta wing behind ours drew it to 237/215/230 and 251/210/225 on a
 * Pixel 8 Pro, redder than blue. Held to blue at least as strong as red, the battle read as `other` for seconds at a
 * time while it flew.
 *
 * That is a range bare sky falls in too: the sky the shield prompt leaves where it hides them measured 210/238/250. The
 * names are what tell the two apart. Their slate-grey text, and the blur the encoder gives it, is 13–18% of their line
 * wherever the panels are drawn across 27,000 recorded frames, counting anything darker than the panel can be; a day
 * sky's prompt has none, and a night sky's no more than 7% where its strips fail anyway. A dark screen is dark all
 * over, hence the ceiling.
 *
 * The text is grey, though, and sky can be as dark: the blue between clouds. Cloud over both strips, 223/244/252 before
 * a GO Battle League battle on a Pixel 4 XL, showed it through up to a quarter of the names' line, and the HUD read as
 * up for the two seconds before it was drawn. That blue is 160 to 200 in chroma at its median, and the names' text no
 * more than 105 on any committed frame and 107 at its median in a battle against Lugia, so the floor counts only what
 * is no more than 120; at 100, that battle's names fell under 8%. The ceiling still counts every colour, a dark screen
 * being dark whatever its colour: held to grey alone, Dazzling Gleam's magenta flash read as the HUD, and so did
 * Xerneas's antlers. Replayed through 513,000 frames of 26 recorded runs, the floor turns only frames with no HUD drawn
 * away from it — the field before a battle, a move's animation, the countdown to an opponent's charged move, which now
 * reads as the shield prompt where it offers one — and the HUD fading in or out.
 *
 * The sky between the panels is the rest of the test, and is what two near misses fail. The map's notifications are a
 * bar straight across the top, and `96% found a Candy!` measured 249/253/243 in the right strip and 204/214/209 in the
 * gap — no sky there, its green over both its red and its blue. The fade into a battle failed the same way, 211/231/227
 * in the gap. Sky, and the grey countdown that sits on it during a prompt, is never greener than it is either red or
 * blue: a clear sky is bluest, and overcast cloud over the autumn map, 201/198/183 in a GO Battle League run on a
 * Pixel 4 XL, reddest. Held to blue at least as strong as green, that run read its battle as `other` and stopped.
 *
 * The panels' colours are each channel's median along a strip rather than its mean, because the strips clip the tops of
 * each side's Poké Balls, and the right one the opponent's shields. A mean takes their colour in — three red balls drew
 * the left strip to 249/245/243 over bright white cloud, where its median is the panel's own 251/254/252 — and the
 * limits above are of a panel, not of a panel and whatever is drawn on it. What is saturated or darker than a panel can
 * be is no more than 8% of a strip on any committed frame, so the median never sees it, however many balls are left.
 */
const HUD: readonly AnchoredBox[] = [
  [0.03, 0.1794, 0.2, 0.2006],
  [0.62, 0.1794, 0.8, 0.2006],
];
const HUD_NAMES: readonly AnchoredBox[] = [
  [0.03, 0.1478, 0.4, 0.1816],
  [0.6, 0.1478, 0.97, 0.1816],
];
const HUD_GAP: AnchoredBox = [0.44, 0.1794, 0.56, 0.2006];
const TEXT = { dark: 180, grey: 120, least: 0.08, most: 0.3 } as const;

const panel = (colour: Colour) => Math.min(...colour) >= 195 && chroma(...colour) <= 52;

/** The shares of a box darker than `TEXT.dark`: of any colour, and of no more colour than `TEXT.grey`. */
function darkIn(image: Image, box: AnchoredBox): { dark: number; grey: number } {
  let [dark, grey, n] = [0, 0, 0];

  for (const colour of pixels(image, box, TOP)) {
    if (luminance(...colour) < TEXT.dark) {
      dark++;
      grey += chroma(...colour) <= TEXT.grey ? 1 : 0;
    }

    n++;
  }

  n = Math.max(n, 1);

  return { dark: dark / n, grey: grey / n };
}

function showsHud(image: Image): boolean {
  const [red, green, blue] = mean(image, HUD_GAP, TOP);

  return (
    green <= Math.max(red, blue) &&
    HUD.every((box) => panel(medianColour(image, box, TOP))) &&
    HUD_NAMES.every((box) => {
      const { dark, grey } = darkIn(image, box);
      return grey >= TEXT.least && dark <= TEXT.most;
    })
  );
}

/**
 * The Protect Shield itself, centred under the prompt: 226/159/240 in every frame of it. The shield going up once it
 * is taken is the same pink, and what tells the two apart is the HUD, which the prompt hides and the shield does not.
 * The prompt's own panel would not do: it is translucent, and measured 77 by luminance over a bright field against 95
 * for the shield going up.
 */
const SHIELD: AnchoredBox = [0.46, -0.4222, 0.54, -0.3378];
const SHIELD_PINK: Colour = [226, 159, 240];

/**
 * Three places on the switch prompt's panel, which is one flat slate — 35/44/58 at each, to within a level — where
 * a fight shows the field and the shield prompt shows the shield.
 *
 * A dark field at night can be that slate too, and the white of the prompt's title, `Switch in a new Pokémon?`, across
 * the middle of its line is what tells the two apart: 19–23% of `SWITCH_TITLE` on `switch-glaceon`, `switch-sneasel`,
 * `switch-pixel8` and two prompts of a GO Battle League run at night, where a charged move's purple burst
 * (`playing-slate-night`) and Dialga standing over the field, which matched the slate's three places in that run,
 * measured 5% and none.
 */
const SWITCH_PANEL: readonly AnchoredBox[] = [
  [0.45, -0.5911, 0.55, -0.5489],
  [0.46, -0.4222, 0.54, -0.3378],
  [0.08, -0.1689, 0.14, -0.1056],
];
const SLATE: Colour = [35, 44, 58];
const SWITCH_TITLE: AnchoredBox = [0.25, -0.56, 0.75, -0.525];
const TITLE_WHITE = 0.1;

/** The share of a box that is white, as the switch prompt's title is on its slate. */
function whiteIn(image: Image, box: AnchoredBox, anchor = BOTTOM): number {
  let [white, n] = [0, 0];

  for (const colour of pixels(image, box, anchor)) {
    white += luminance(...colour) > 200 ? 1 : 0;
    n++;
  }

  return white / Math.max(n, 1);
}

/**
 * The countdown the opponent's charged move puts up at the top of the screen while its minigame plays: a disc of
 * translucent black, the seconds left in white at its middle and a white arc around it running down with them. It is
 * over the shield prompt and the switch prompt too, but with none of our shields left the throw puts up no prompt, and
 * the countdown and `No Protect Shields remaining!` across the middle, five seconds of each, are all there is to see of
 * it. The disc is 148–212 by 32–96 of 360 on a Pixel 4 XL's prompts and a Pixel 8 Pro's alike, so it is pinned to the
 * top: centred, 0.178 widths down, a radius of 0.089.
 *
 * Two things tell it. Being translucent black, it darkens whatever is behind it by about half, under cloud or a night
 * sky alike: points on a circle between its numeral and its arc against the points straight out from them beyond its
 * edge read 100–117 to 213–234 by luminance on the Pixel 4 XL's prompts, and 36 to 81 on the Pixel 8 Pro's at night.
 * And its numeral is white on that dark ground, 21–35% of a box about the middle, where the HUD's panels, cloud and
 * the field leave it all white or none of it.
 *
 * Measured over 12 GO Battle League battles recorded off a Pixel 8 Pro, at 10 frames a second: of the 26 throws made
 * with none of our shields left, every one passes for its whole five seconds bar three frames at most, 1,305 of the
 * 1,326 frames of them that read as `other`; of the 6,252 frames that read as `other` away from those throws and from
 * any prompt, none does, the most of their points darker 46% where the numeral's box was in range and 67% where not.
 * A Galarian Moltres's wing behind part of the disc took it to 79% (`other-pixel8-countdown-wing`), still a pass.
 */
const COUNTDOWN = { x: 0.5, y: 0.1778, inside: 0.054, outside: 0.108, points: 24 } as const;
const COUNTDOWN_NUMERAL: AnchoredBox = [0.475, 0.1428, 0.525, 0.2128];

/** How much darker a point inside the disc must be than the one beyond it, and on how many of the points. */
const DIMMED = { by: 0.75, share: 0.75 } as const;
const NUMERAL_WHITE = { least: 0.1, most: 0.45 } as const;

/**
 * Whether the opponent's charged-move countdown is up. Only meaningful on a frame `recognise` reads as `other`, the
 * prompts carrying it too.
 */
export function countdown(image: Image): boolean {
  const at = (radius: number, angle: number) =>
    luminance(
      ...rgb(
        image,
        (COUNTDOWN.x + radius * Math.cos(angle)) * image.width,
        (COUNTDOWN.y + radius * Math.sin(angle)) * image.width,
      ),
    );

  let dimmed = 0;

  for (let k = 0; k < COUNTDOWN.points; k++) {
    const angle = (2 * Math.PI * k) / COUNTDOWN.points;

    if (at(COUNTDOWN.inside, angle) < DIMMED.by * at(COUNTDOWN.outside, angle)) {
      dimmed++;
    }
  }

  const numeral = whiteIn(image, COUNTDOWN_NUMERAL, TOP);

  return dimmed / COUNTDOWN.points >= DIMMED.share && numeral >= NUMERAL_WHITE.least && numeral <= NUMERAL_WHITE.most;
}

/**
 * The charged-move buttons, as the circles their rims trace: one move's centred at 179.5,676 of 360×760, and two moves'
 * either side of it at the same height, all with a radius of 34. A button with a move ready wears a white rim, and one
 * without wears none: 32 points around the circle were white at 88–100% of them for a ready button, at none for an
 * unready one, and at no more than 44% through the minigame's bubbles.
 *
 * A ring is the rest of the test, white inside and outside it being what a ready button is not. Kyogre's belly is a
 * white patch across the centred button's place, and read as a ready button through its whole minigame on the rim alone
 * — white at every point, but white too at every point inside it and outside it, where a ready button measured no more
 * than 16% within and 13% beyond.
 */
export const BUTTON_XS = [0.31, 0.499, 0.69] as const;
const BUTTON = { y: -0.2343, radius: 0.094 } as const;
const RIM_POINTS = 32;
const RIM_READY = 0.6;
const AROUND_RIM = 0.3;

/** The fraction of a circle that is white, each point looked for a pixel or two inside the radius, the rim's width. */
function white(image: Image, cx: number, cy: number, radius: number): number {
  let hits = 0;

  for (let k = 0; k < RIM_POINTS; k++) {
    const angle = (2 * Math.PI * k) / RIM_POINTS;

    const hit = [0, 1, 2].some((inset) => {
      const r = radius - inset * (image.width / 360);
      const colour = rgb(image, cx + r * Math.cos(angle), cy + r * Math.sin(angle));

      return luminance(...colour) > 215 && chroma(...colour) < 40;
    });

    if (hit) {
      hits++;
    }
  }

  return hits / RIM_POINTS;
}

/**
 * Where a charged move is ready to throw, as the centre of each lit button, left to right: none, one, or both of two.
 * Only meaningful on a frame `recognise` reads as a battle.
 */
export function readyButtons(image: Image): [x: number, y: number][] {
  const y = down(BUTTON.y, BOTTOM, image);
  const cy = y * image.height;
  const radius = BUTTON.radius * image.width;

  return BUTTON_XS.filter((x) => {
    const cx = x * image.width;

    return (
      white(image, cx, cy, radius) >= RIM_READY &&
      white(image, cx, cy, radius * 0.6) <= AROUND_RIM &&
      white(image, cx, cy, radius * 1.35) <= AROUND_RIM
    );
  }).map((x) => [x, y]);
}

/**
 * The name of each charged move, printed beneath its button in grey letters on the dark band the fight draws along the
 * foot: drawn under every button, lit or not, through the fight and nowhere else. From the tap that throws a move, or
 * the opponent's throw, until the fight comes back, the buttons and their names are gone, the HUD staying up.
 *
 * Told by the letters' edges: neighbouring pixels within `EDGE.half` of the width of a button's x differing by more
 * than `EDGE.by` in luminance, the lighter of them grey, counted per row over the name's rows and taken less those over
 * the bare rows beside it, above and below, which artwork crosses as often as the name's own. A lit button's name is
 * larger and lower, where its own rows and the unlit name's bare ones are looked at as well: its button is `charged`,
 * but our tap's white ring around it hid its rim from `readyButtons` for up to ten frames at a time, and so did a lit
 * button dimming for the throw. On the committed frames every unlit name read 6.8 or more, Fly's three letters the
 * least and the rest 16 or more, and every lit one 13 or more, where nothing else read more than 2.5.
 *
 * Replayed over every frame of 20 runs kept with video, the fight read otherwise for no more than 0.15s with a second of
 * it either side, but where ours was sent in, which shows no button until it has flown in, 1.6s and more. A fast move's
 * flash can wash the names out for longer, which `FLASH_MS` in `run.mts` waits out: Lugia's did for up to 0.46s. A name
 * read where none was drawn lasted a few frames at a time, the white of Kyogre's jaw through its own minigame among it.
 */
const NAMES = [
  {
    letters: [-0.1306, -0.1111],
    beside: [
      [-0.15, -0.137],
      [-0.105, -0.095],
    ],
  },
  {
    letters: [-0.1028, -0.0778],
    beside: [
      [-0.1306, -0.1111],
      [-0.074, -0.058],
    ],
  },
] as const;
const EDGE = { by: 25, grey: 40, half: 0.09 } as const;
const NAMED = 5;

/** The edges per row between rows `top` and `bottom` widths above the foot, across `x` ± `EDGE.half`. */
function edges(image: Image, x: number, [top, bottom]: readonly [number, number]): number {
  const unit = image.width / 360;
  const [from, to] = rows(image, top, bottom, BOTTOM);
  const [left, right] = [x - EDGE.half, x + EDGE.half].map((at) => Math.round(at * image.width)) as [number, number];
  let found = 0;

  for (let y = from; y <= to; y++) {
    for (let px = left; px < right; px += unit) {
      const [a, b] = [rgb(image, px, y), rgb(image, px + unit, y)];
      const [lighter, darker] = luminance(...a) > luminance(...b) ? [a, b] : [b, a];

      if (luminance(...lighter) - luminance(...darker) > EDGE.by && chroma(...lighter) < EDGE.grey) {
        found++;
      }
    }
  }

  return found / (to - from + 1);
}

/** Whether any of the charged moves' names is drawn beneath its button, lit or not: the fight's own frames. */
function named(image: Image): boolean {
  return BUTTON_XS.some((x) =>
    NAMES.some(
      ({ letters, beside: [above, below] }) =>
        edges(image, x, letters) - edges(image, x, above) - edges(image, x, below) >= NAMED,
    ),
  );
}

/**
 * The opponent's two shields along the top, as small boxes at the centre of each hexagon. One still held is pink,
 * measured 223–233/159–167/235–248 on the committed frames, under day and night skies alike; one spent is a dark
 * purple, 108–116/79–82/113–123, and the left goes first.
 */
const OPPONENT_SHIELDS: readonly AnchoredBox[] = [0.718, 0.764].map(
  (x) => [x - 0.006, 0.2027, x + 0.006, 0.2153] as const,
);
const SPENT: Colour = [111, 81, 118];

/**
 * How many shields the opponent has left, out of the two each side starts with. A hexagon that reads as neither colour
 * — under a banner, say — counts as one still held, as costing a bait at worst where the other way round would throw
 * the strongest move into a shield.
 */
export function opponentShields(image: Image): number {
  return OPPONENT_SHIELDS.filter((box) => !near(mean(image, box, TOP), SPENT, 25)).length;
}

/**
 * Our two shields, at the left of the HUD where the opponent's are at its right, and the right of them going first.
 * The same two colours, measured on the committed frames and on 92 frames of two GO Battle League runs that read as a
 * battle: 214–234/156–165/230–245 held and 107–112/78–83/112–121 spent.
 */
const OWN_SHIELDS: readonly AnchoredBox[] = [0.236, 0.281].map((x) => [x - 0.006, 0.2027, x + 0.006, 0.2153] as const);
const HELD: Colour = [224, 161, 238];

/**
 * How many shields we have left, or null where a hexagon reads as neither colour rather than a guess either way, unlike
 * the opponent's: what this answers is whether a shield prompt can be taken at all.
 */
export function ownShields(image: Image): number | null {
  const colours = OWN_SHIELDS.map((box) => mean(image, box, TOP));

  if (!colours.every((colour) => near(colour, HELD, 20) || near(colour, SPENT, 25))) {
    return null;
  }

  return colours.filter((colour) => near(colour, HELD, 20)).length;
}

/**
 * Each side's three Poké Balls along the top, beside its shields: ours at the far left, the opponent's at the far
 * right, centres measured at 21, 40 and 58 and at 303, 321 and 340 of 360 on the committed frames. One still able to
 * battle is red, 174–245/36–98/35–98 across the Pixel 4 XL's frames and the Pixel 8's darker ones; one fainted is grey,
 * 85–115/66–88/69–89, and the leftmost goes first.
 */
const BALLS = {
  own: [0.058, 0.111, 0.161],
  opponent: [0.842, 0.892, 0.944],
} as const;

const ball = (x: number): AnchoredBox => [x - 0.006, 0.1963, x + 0.006, 0.209];
const red = ([r, g, b]: Colour) => r > 150 && r - g > 60 && r - b > 60;
const grey = ([r, g, b]: Colour) => r < 130 && Math.abs(r - g) < 45 && Math.abs(g - b) < 20;

/**
 * How many Pokémon each side has left able to battle, or null for a side where a ball reads as neither colour, as
 * where the shield prompt hides the HUD.
 */
export function pokemonLeft(image: Image): { own: number | null; opponent: number | null } {
  const left = (xs: readonly number[]) => {
    const colours = xs.map((x) => mean(image, ball(x), TOP));

    return colours.every((colour) => red(colour) || grey(colour)) ? colours.filter(red).length : null;
  };

  return { own: left(BALLS.own), opponent: left(BALLS.opponent) };
}

export function recognise(image: Image): State {
  if (
    SWITCH_PANEL.every((box) => near(mean(image, box, BOTTOM), SLATE, 12)) &&
    whiteIn(image, SWITCH_TITLE) >= TITLE_WHITE
  ) {
    return 'switch';
  }

  const hud = showsHud(image);

  if (!hud && near(mean(image, SHIELD, BOTTOM), SHIELD_PINK, 25)) {
    return 'shield';
  }

  if (!hud) {
    return 'other';
  }

  if (readyButtons(image).length > 0) {
    return 'charged';
  }

  return named(image) ? 'battle' : 'playing';
}

/**
 * What a frame of the battle is told by, for `overlay.mts`: every box above, where it is sampled. Each of them is needed,
 * the HUD's strips and names together saying it is up, and each button, shield and Poké Ball read on its own; a button
 * as far out as the ring around its rim that has to stay dark, and each move's name with the bare rows either side.
 */
export function areas(screen: Size): Area[] {
  const at = (boxes: readonly AnchoredBox[], anchor: number) => boxes.map((box) => spanning(box, anchor, screen));

  return [
    { name: "the battle's names and CPs", boxes: at([...HUD, ...HUD_NAMES, HUD_GAP], TOP) },
    { name: 'the Protect Shield prompt', boxes: at([SHIELD], BOTTOM) },
    { name: 'the switch prompt', boxes: at([...SWITCH_PANEL, SWITCH_TITLE], BOTTOM) },
    {
      name: "the shield prompt's countdown",
      boxes: [around([COUNTDOWN.x, COUNTDOWN.y], COUNTDOWN.outside, TOP, screen), ...at([COUNTDOWN_NUMERAL], TOP)],
    },
    {
      name: "the charged moves' buttons",
      boxes: BUTTON_XS.map((x) => around([x, BUTTON.y], BUTTON.radius * 1.35, BOTTOM, screen)),
    },
    {
      name: "the charged moves' names",
      boxes: at(
        BUTTON_XS.map((x) => [x - EDGE.half, NAMES[0].beside[0][0], x + EDGE.half, NAMES[1].beside[1][1]] as const),
        BOTTOM,
      ),
    },
    { name: "each side's shields", boxes: at([...OWN_SHIELDS, ...OPPONENT_SHIELDS], TOP) },
    { name: "each side's Poké Balls", boxes: at([...BALLS.own, ...BALLS.opponent].map(ball), TOP) },
  ];
}
