/**
 * Per-user rate limiting.
 *
 * Two separate protections, because they guard different things:
 *
 *  - a token bucket caps how many requests a person makes over time;
 *  - an in-flight guard refuses a second concurrent request of the same kind.
 *
 * The second matters more than it looks. A search takes half a minute because
 * a model runs, and people who wait half a minute retype their question. Model
 * runs are serialised, so without this one impatient person queues five runs
 * and waits five times as long — the retries cause the very slowness that
 * provoked them.
 *
 * State is in memory on purpose. A restart clearing limits is acceptable;
 * writing to SQLite on every request to survive one is not a trade worth
 * making for this.
 */

export type Rule = {
  /** Maximum burst. */
  capacity: number;
  /** Tokens returned per minute. */
  refillPerMinute: number;
};

export type Verdict =
  | { allowed: true }
  | { allowed: false; reason: "too_many"; retryAfterSeconds: number }
  | { allowed: false; reason: "in_flight"; retryAfterSeconds: number };

type Bucket = { tokens: number; updatedAt: number };

export class RateLimiter {
  readonly #rules: Record<string, Rule>;
  readonly #buckets = new Map<string, Bucket>();
  readonly #inFlight = new Set<string>();
  readonly #now: () => number;

  constructor(rules: Record<string, Rule>, now: () => number = Date.now) {
    this.#rules = rules;
    this.#now = now;
  }

  /**
   * Takes a token, or explains why not. Call `release` when the work finishes
   * if `startsWork` was set.
   */
  take(action: string, userId: number, startsWork = false): Verdict {
    const rule = this.#rules[action];
    if (rule === undefined) return { allowed: true };

    const key = `${action}:${userId}`;

    if (startsWork && this.#inFlight.has(key)) {
      return { allowed: false, reason: "in_flight", retryAfterSeconds: 5 };
    }

    const now = this.#now();
    const bucket = this.#buckets.get(key) ?? {
      tokens: rule.capacity,
      updatedAt: now,
    };

    const refilled = Math.min(
      rule.capacity,
      bucket.tokens + ((now - bucket.updatedAt) / 60_000) * rule.refillPerMinute,
    );

    if (refilled < 1) {
      // Report when one whole token is back, not when the bucket is full.
      const seconds = Math.ceil(((1 - refilled) / rule.refillPerMinute) * 60);
      this.#buckets.set(key, { tokens: refilled, updatedAt: now });
      return {
        allowed: false,
        reason: "too_many",
        retryAfterSeconds: Math.max(1, seconds),
      };
    }

    this.#buckets.set(key, { tokens: refilled - 1, updatedAt: now });
    if (startsWork) this.#inFlight.add(key);
    return { allowed: true };
  }

  release(action: string, userId: number): void {
    this.#inFlight.delete(`${action}:${userId}`);
  }
}
