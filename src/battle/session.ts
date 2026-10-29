/**
 * The Battle tab's run, held for the document rather than by the tab: a run goes on in its Worker whichever tab is
 * open, holding the phone, so leaving the Battle tab and coming back finds it still running, its Stop button with it,
 * and what it has told so far. One run at a time, a phone being lent to one Worker at a time.
 */

import { useEffect, useState } from 'preact/hooks';

import { said } from '../errors.js';
import { type PhoneStore } from '../phone-store.js';
import { ending, type Reporter, type Status } from '../tools/battle/reporter.mts';
import { type Mode } from '../tools/battle/menus.mts';
import { lend, type Run } from './client.js';
import { loadBattle } from './load.js';

/** Something the run did once, by one side or by the run itself, as `Reporter.event` tells it. */
export interface Told {
  line: string;
  side?: 'own' | 'opponent' | undefined;
  why?: string | undefined;
}

export type Phase =
  | { kind: 'idle' }
  | { kind: 'connecting'; message: string }
  | { kind: 'running'; run: Run; stopping: boolean }

  // How it ended, in lines: how the battles went, `Stopped.`, or why it failed where `failed`.
  | { kind: 'over'; lines: string[]; failed: boolean };

/** Events kept, the oldest let go: far more than the tab shows, as `live` keeps more than a terminal is tall. */
const KEPT = 1_000;

export class Session {
  phase: Phase = { kind: 'idle' };

  /** How the run stands as last told, and what it did, oldest first, kept once it is over until the next starts. */
  status: Status | undefined;
  told: Told[] = [];

  readonly #listeners = new Set<() => void>();

  readonly #report: Reporter = {
    event: (line, side, why) => {
      this.told.push({ line, side, why });
      this.told.splice(0, this.told.length - KEPT);
      this.#emit();
    },
    status: (status) => {
      this.status = status;
      this.#emit();
    },
  };

  /**
   * Plays `count` battles of `mode` on the phone `store` holds, its game data loaded first so that a failure to load
   * any leaves the phone untouched.
   */
  async start(store: PhoneStore, { mode, count }: { mode: Mode; count: number }): Promise<void> {
    if (this.phase.kind === 'connecting' || this.phase.kind === 'running') {
      return;
    }

    this.status = undefined;
    this.told = [];
    this.#set({ kind: 'connecting', message: 'Loading the game data…' });

    let run: Run;

    try {
      const { data, icons, typeIcons, meta } = await loadBattle(mode.mode === 'gbl' ? mode.league : null);

      this.#set({ kind: 'connecting', message: 'Handing the phone to the battle and waiting for its screen…' });

      run = await lend(
        store,
        { battle: { mode, data, icons, typeIcons, meta, count }, base: location.href },
        this.#report,
      );
    } catch (error) {
      this.#set({ kind: 'over', lines: [said(error)], failed: true });
      return;
    }

    this.#set({ kind: 'running', run, stopping: false });

    try {
      const tally = await run.ended;
      this.#set({ kind: 'over', lines: tally ? ending(tally, count) : ['Stopped.'], failed: false });
    } catch (error) {
      this.#set({ kind: 'over', lines: [said(error)], failed: true });
    }
  }

  stop(): void {
    if (this.phase.kind === 'running' && !this.phase.stopping) {
      this.phase.run.stop();
      this.#set({ ...this.phase, stopping: true });
    }
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  }

  #set(phase: Phase) {
    this.phase = phase;
    this.#emit();
  }

  #emit() {
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

/** The document's run, which outlives any one visit to the tab. */
export const session = new Session();

/**
 * The run, with the calling component redrawn as it changes: once a frame at most, a status coming with each of the
 * phone's 30 frames a second, and not at all while the page is hidden, where no frame is drawn.
 */
export function useSession(): Session {
  const [, redraw] = useState(0);

  useEffect(() => {
    let pending: number | undefined;

    const unsubscribe = session.subscribe(() => {
      pending ??= requestAnimationFrame(() => {
        pending = undefined;
        redraw((count) => count + 1);
      });
    });

    return () => {
      unsubscribe();

      if (pending !== undefined) {
        cancelAnimationFrame(pending);
      }
    };
  }, []);

  return session;
}
