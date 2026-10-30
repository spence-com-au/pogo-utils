/**
 * The Battle page: Team Leader training or GO Battle League battles played on the phone, as `pnpm battle run` plays
 * them, from the browser. The phone connected from the settings menu is lent to the battle's Worker for the run, which
 * plays it there, where a hidden tab's timers are not held back, and tells the page what it does: how the run stands,
 * the two sides of the battle, what each does and the menus it taps through, drawn as the terminal draws its panel,
 * with the phone's screen beside them.
 *
 * The run is the document's rather than the page's, in `session.ts`, so it goes on while another tab is open and is
 * found again, Stop and all, on coming back.
 */

import { type ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { useSession, session, type Told } from '../battle/session.js';
import { DEMO_BATTLE } from '../generated.js';
import { DEMO_SERIAL, phoneStore, usePhone } from '../phone-store.js';
import { LEADERS, LEAGUES } from '../tools/battle/menus.mts';
import { OptionError, readOptions, type Asked } from '../tools/battle/options.mts';
import { energyOf, PARTY, summary, type Fight, type Side } from '../tools/battle/reporter.mts';
import { type Image } from '../tools/inventory/png.mts';

/**
 * The form as typed: every field, whichever mode leaves it out. Each mode has its own league, Training's one of three
 * and GO Battle League's any name, so that switching modes leaves neither holding the other's.
 */
export interface Fields {
  mode: 'training' | 'gbl';
  leader: string;
  league: string;
  gblLeague: string;
  party: string;
  count: string;
}

/** What each option is called on the page, which a refusal reads after as `--count` reads on the command line. */
const LABELS: Record<keyof Asked, string> = {
  mode: 'Mode',
  leader: 'Leader',
  league: 'League',
  party: 'Party',
  count: 'Count',
};

/**
 * The options the form asks for, as `pnpm battle run`'s flags would: a leader for Training alone and a party for GO
 * Battle League alone, whatever was typed into the other's field before the mode changed, and a blank party or count
 * as one not given, which is whichever party the screen opens on, and battles until stopped.
 */
export function askedOf({ mode, leader, league, gblLeague, party, count }: Fields): Asked {
  return {
    mode,
    league: mode === 'training' ? league : gblLeague,
    ...(mode === 'training' ? { leader } : party.trim() && { party }),
    ...(count.trim() && { count: count.trim() }),
  };
}

/**
 * The form read as a run, or why it cannot be: the CLI's rules and words, each refusal headed by its field's label.
 */
export function optionsOf(fields: Fields): ReturnType<typeof readOptions> | { refused: string } {
  try {
    return readOptions(askedOf(fields));
  } catch (error) {
    if (error instanceof OptionError) {
      return { refused: `${LABELS[error.option]} ${error.says}.` };
    }

    throw error;
  }
}

/**
 * How often the canvas asks the Worker for a frame, in milliseconds: ten a second, as the terminal's panel draws the
 * phone, each a megabyte cloned across the Worker's boundary.
 */
const PICTURE_MS = 100;

/** How many of each side's events and of the run's own the panel shows, the latest last. */
const SHOWN = 200;
const RUN_SHOWN = 8;

/** `image` drawn into `canvas`, sized to it. */
function draw(canvas: HTMLCanvasElement, { width, height, data }: Image) {
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const pixels = new Uint8ClampedArray(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);

  canvas.getContext('2d')?.putImageData(new ImageData(pixels, width, height), 0, 0);
}

/**
 * The phone's screen on a canvas while a run goes on, and its last frame once it is over. Frames are asked for by
 * animation frame, which a hidden page is given none of, so a page out of sight asks the Worker for nothing while its
 * run plays on, and asks again once it is looked at.
 */
function Phone() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { phase } = session;
  const run = phase.kind === 'running' ? phase.run : null;

  useEffect(() => {
    if (!run) {
      return;
    }

    let asking = false;
    let askedAt = -Infinity;
    let next = requestAnimationFrame(function look(now) {
      next = requestAnimationFrame(look);

      if (asking || now - askedAt < PICTURE_MS) {
        return;
      }

      asking = true;
      askedAt = now;

      void run.frame().then((image) => {
        asking = false;

        if (image && canvas.current) {
          draw(canvas.current, image);
        }
      });
    });

    return () => cancelAnimationFrame(next);
  }, [run]);

  return <canvas class="screen" ref={canvas} width={9} height={19} aria-label="The phone’s screen" />;
}

/**
 * `on` of `of` drawn as dots, as the game draws shields and Poké Balls, or each dashed where `on` is unread: the
 * terminal's `●` and `◓`, which a page's fonts draw unevenly.
 */
const Dots = (props: { class: string; of: number; on: number | null; label: string }) => (
  <span class={props.class} role="img" aria-label={`${props.on ?? '?'} ${props.label}`}>
    {Array.from({ length: props.of }, (_, i) => (
      <i key={i} class={props.on === null ? 'unread' : i < props.on ? 'on' : undefined} />
    ))}
  </span>
);

/** One side as the terminal's panel draws it: name, how strong, its HP and the party it has left. */
function SideOf({ side, title, children }: { side: Side; title: string; children?: ComponentChildren }) {
  const { hp, left, shields } = side;

  return (
    <div class="side">
      <h3>{title}</h3>
      <p class="name">
        <strong>{side.species ?? '?'}</strong> <span>CP {side.cp ?? '?'}</span>
      </p>
      <div
        class="hp"
        role="meter"
        aria-label="HP"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={hp === null ? undefined : Math.round(hp * 100)}
      >
        <span style={{ width: `${Math.round((hp ?? 0) * 100)}%` }} />
      </div>
      <p class="strength">
        <span>{hp === null ? '?' : Math.round(hp * 100)}%</span>
        <Dots class="shields" of={2} on={shields} label="shields left" />
        <Dots class="balls" of={PARTY} on={left} label={`of ${PARTY} Pokémon left`} />
      </p>
      {children}
    </div>
  );
}

/** The battle under way, ours at the left and theirs at the right, and what is to be done in it. */
function Battle({ fight }: { fight: Fight | undefined }) {
  if (!fight) {
    return <p class="none">No battle yet.</p>;
  }

  return (
    <div class="sides">
      <SideOf side={fight.own} title="Ours">
        {fight.ourEnergy && <p>energy {energyOf(fight.ourEnergy)}</p>}
        <p>{fight.moves.join(', ') || '?'}</p>
        <p>
          {fight.bait ? 'baiting with' : 'throwing'} {fight.throwing ?? 'the first ready'}
        </p>
        <p>{fight.shield ? 'shielding' : 'not shielding'}</p>
      </SideOf>
      <SideOf side={fight.opponent} title="Theirs">
        {fight.energy && <p>energy {energyOf(fight.energy)}</p>}
      </SideOf>
    </div>
  );
}

/** An event, with why after it drawn as less to read. */
const Line = ({ told: { line, why } }: { told: Told }) => (
  <>
    {line}
    {why && <span class="why">: {why}</span>}
  </>
);

/**
 * The panel the terminal draws: how the run stands above, the battle and what each side did, ours at the left and
 * theirs at the right, and the menus the run tapped through below.
 */
function Panel() {
  const { status, told } = session;
  const sides = told.filter(({ side }) => side).slice(-SHOWN);
  const runs = told.filter(({ side }) => !side).slice(-RUN_SHOWN);

  return (
    <section class="panel board">
      <p class="summary">{summary(status)}</p>
      <Battle fight={status?.fight} />
      {/* Newest at the foot, kept in view by laying the list out from the foot up. */}
      <ol class="did">
        {sides.reverse().map((one, i) => (
          <li key={i} class={one.side}>
            <Line told={one} />
          </li>
        ))}
      </ol>
      <ol class="runs">
        {runs.map((one, i) => (
          <li key={i}>
            <Line told={one} />
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function BattlePage() {
  const { phase } = useSession();
  const phone = usePhone();
  const [fields, setFields] = useState<Fields>({
    mode: 'training',
    leader: 'spark',
    league: 'great',
    gblLeague: '',
    party: '',
    count: '',
  });
  const [refused, setRefused] = useState<string | null>(null);

  // The demo phone plays the one battle it recorded, whatever is asked of it, so the form says which and is held there.
  const demo = phone?.serial === DEMO_SERIAL;
  const shown: Fields = demo
    ? { ...fields, mode: 'training', leader: DEMO_BATTLE.leader, league: DEMO_BATTLE.league }
    : fields;
  const recorded = demo ? 'The demo phone plays the battle it recorded' : undefined;

  const busy = phase.kind === 'connecting' || phase.kind === 'running';
  const field = (name: keyof Fields) => (event: Event) =>
    setFields({ ...fields, [name]: (event.currentTarget as HTMLInputElement | HTMLSelectElement).value });

  function start(event: Event) {
    event.preventDefault();

    const options = optionsOf(shown);

    if ('refused' in options) {
      setRefused(options.refused);
      return;
    }

    setRefused(null);
    void session.start(phoneStore, options);
  }

  const state =
    phase.kind === 'connecting'
      ? phase.message
      : phase.kind === 'running'
        ? phase.stopping
          ? 'Stopping, and putting the phone back as it was…'
          : 'Running. Leave the phone be until it stops.'
        : demo
          ? 'Ready to play on the demo phone: a recorded Training battle, which plays the same whatever is tapped.'
          : phone
            ? `Ready to play on ${phone.name}.`
            : 'No phone connected: connect one from Settings (⚙️ in the top bar).';

  return (
    <>
      <header class="page">
        <h1>Battle</h1>
        <p class="sub">
          Play Team Leader training or GO Battle League battles on an Android phone, the way{' '}
          <code>pnpm battle run</code> does, in the browser: it watches the screen and taps through each battle and the
          menus between them, from the map or anywhere between one battle and the next.
        </p>
      </header>

      <main class="battle">
        <form class="panel options" onSubmit={start}>
          <div class="fields">
            <label>
              Mode
              <select value={shown.mode} disabled={busy || demo} title={recorded} onChange={field('mode')}>
                <option value="training">Team Leader training</option>
                <option value="gbl">GO Battle League</option>
              </select>
            </label>

            {shown.mode === 'training' ? (
              <>
                <label>
                  Leader
                  <select value={shown.leader} disabled={busy || demo} title={recorded} onChange={field('leader')}>
                    {LEADERS.map((leader) => (
                      <option key={leader} value={leader}>
                        {leader[0]?.toUpperCase() + leader.slice(1)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  League
                  <select value={shown.league} disabled={busy || demo} title={recorded} onChange={field('league')}>
                    {LEAGUES.map((league) => (
                      <option key={league} value={league}>
                        {league[0]?.toUpperCase() + league.slice(1)} League
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <>
                <label>
                  League
                  <input
                    type="text"
                    autocomplete="off"
                    placeholder="ultra, fantasy cup…"
                    value={fields.gblLeague}
                    disabled={busy}
                    onInput={field('gblLeague')}
                  />
                </label>
                <label>
                  Party
                  <input
                    type="text"
                    autocomplete="off"
                    placeholder="the one the screen opens on"
                    value={fields.party}
                    disabled={busy}
                    onInput={field('party')}
                  />
                </label>
              </>
            )}

            <label>
              Count
              <input
                type="text"
                inputMode="numeric"
                autocomplete="off"
                placeholder="until stopped"
                value={fields.count}
                disabled={busy}
                onInput={field('count')}
              />
            </label>
          </div>

          <div class="actions">
            <button class="run" type="submit" disabled={busy || phone === null}>
              Start
            </button>
            <button
              class="ghost"
              type="button"
              disabled={phase.kind !== 'running' || phase.stopping}
              onClick={() => session.stop()}
            >
              Stop
            </button>
          </div>

          {refused && (
            <p class="status err" role="alert">
              {refused}
            </p>
          )}
        </form>

        <p class={phase.kind === 'over' && phase.failed ? 'status err' : 'status'} role="status">
          {phase.kind === 'over' ? phase.lines.map((line) => <span key={line}>{line}</span>) : state}
        </p>

        {phase.kind !== 'idle' && phase.kind !== 'connecting' && (
          <div class="arena">
            <Phone />
            <Panel />
          </div>
        )}
      </main>
    </>
  );
}
