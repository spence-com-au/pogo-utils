/**
 * How long to wait after a request fails, doubling from the poll interval to a ceiling and starting over on the first
 * answer. A refused or failed request is retried at the poll rate by nothing: a 429 asked again every fifteen seconds
 * is how one account becomes a banned one, and an outage asked about that often is load on somebody else's bad day.
 *
 * Jittered by up to a quarter either way so that a watcher restarted alongside another does not keep step with it. The
 * random source is a parameter so a test can hold it still.
 */
export class Backoff {
  #failures = 0;
  readonly #base: number;
  readonly #ceiling: number;
  readonly #random: () => number;

  /** `base` and `ceiling` in milliseconds. */
  constructor(base: number, ceiling: number, random: () => number = Math.random) {
    this.#base = base;
    this.#ceiling = ceiling;
    this.#random = random;
  }

  /** The wait before the next attempt, having just failed. */
  failed(): number {
    this.#failures += 1;

    const plain = Math.min(this.#ceiling, this.#base * 2 ** this.#failures);

    // Clamped after the jitter as well as before it, so the ceiling is a bound on the wait and not only on its centre.
    return Math.min(this.#ceiling, Math.round(plain * (0.75 + this.#random() / 2)));
  }

  succeeded(): void {
    this.#failures = 0;
  }
}
