/**
 * A counting semaphore.
 *
 * Extracted from CodexModel so the hand-off can be tested. The naive version —
 * decrement on release, let the woken waiter increment — over-admits: between
 * resolving a waiter and that waiter's continuation actually running, the count
 * is momentarily free, and a caller arriving in that window takes the slot too.
 * Both then proceed. With a limit of one, two heavy processes run at once.
 *
 * The fix is to transfer the slot rather than free it: release hands the
 * permit straight to the next waiter and leaves the count alone.
 */
export class Semaphore {
  readonly #limit: number;
  #held = 0;
  readonly #waiting: Array<() => void> = [];

  constructor(limit: number) {
    this.#limit = Math.max(1, limit);
  }

  /** For tests and diagnostics: how many permits are currently out. */
  get held(): number {
    return this.#held;
  }

  async acquire(): Promise<void> {
    if (this.#held < this.#limit) {
      this.#held += 1;
      return;
    }
    // The permit is granted by release(), which does not decrement — so the
    // count never dips below the true number of holders.
    await new Promise<void>((resolve) => this.#waiting.push(resolve));
  }

  release(): void {
    const next = this.#waiting.shift();
    if (next === undefined) {
      this.#held -= 1;
      return;
    }
    next();
  }

  /** Runs `work` holding a permit, releasing it however it ends. */
  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await work();
    } finally {
      this.release();
    }
  }
}
