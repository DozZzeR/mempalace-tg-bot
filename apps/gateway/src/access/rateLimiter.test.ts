import { describe, expect, test } from "vitest";
import { RateLimiter } from "./rateLimiter.ts";

const RULES = { search: { capacity: 3, refillPerMinute: 3 } };

function limiterAt(clock: { now: number }) {
  return new RateLimiter(RULES, () => clock.now);
}

describe("token bucket", () => {
  test("allows a burst up to capacity", () => {
    const clock = { now: 0 };
    const limiter = limiterAt(clock);

    for (let i = 0; i < 3; i += 1) {
      expect(limiter.take("search", 1).allowed).toBe(true);
    }
    expect(limiter.take("search", 1).allowed).toBe(false);
  });

  test("says when to come back, not just no", () => {
    const clock = { now: 0 };
    const limiter = limiterAt(clock);
    for (let i = 0; i < 3; i += 1) limiter.take("search", 1);

    const verdict = limiter.take("search", 1);
    if (verdict.allowed) throw new Error("expected a refusal");
    // 3 tokens per minute means one back in 20 seconds.
    expect(verdict.retryAfterSeconds).toBe(20);
  });

  test("refills over time", () => {
    const clock = { now: 0 };
    const limiter = limiterAt(clock);
    for (let i = 0; i < 3; i += 1) limiter.take("search", 1);

    clock.now = 20_000;
    expect(limiter.take("search", 1).allowed).toBe(true);
  });

  test("never refills past capacity", () => {
    const clock = { now: 0 };
    const limiter = limiterAt(clock);
    limiter.take("search", 1);

    clock.now = 60 * 60 * 1000;
    for (let i = 0; i < 3; i += 1) {
      expect(limiter.take("search", 1).allowed).toBe(true);
    }
    expect(limiter.take("search", 1).allowed).toBe(false);
  });

  test("counts each person separately", () => {
    const clock = { now: 0 };
    const limiter = limiterAt(clock);
    for (let i = 0; i < 3; i += 1) limiter.take("search", 1);

    expect(limiter.take("search", 2).allowed).toBe(true);
  });

  test("leaves unlisted actions alone", () => {
    const limiter = limiterAt({ now: 0 });
    for (let i = 0; i < 100; i += 1) {
      expect(limiter.take("notes", 1).allowed).toBe(true);
    }
  });
});

describe("in-flight guard", () => {
  test("refuses a second concurrent request of the same kind", () => {
    const limiter = limiterAt({ now: 0 });

    expect(limiter.take("search", 1, true).allowed).toBe(true);
    const second = limiter.take("search", 1, true);

    // The point: model runs are serialised, so a retype would queue behind the
    // first and make the wait longer, not shorter.
    expect(second.allowed).toBe(false);
    if (!second.allowed) expect(second.reason).toBe("in_flight");
  });

  test("lets the next one through once the first finishes", () => {
    const limiter = limiterAt({ now: 0 });
    limiter.take("search", 1, true);
    limiter.release("search", 1);

    expect(limiter.take("search", 1, true).allowed).toBe(true);
  });

  test("does not block a different person", () => {
    const limiter = limiterAt({ now: 0 });
    limiter.take("search", 1, true);

    expect(limiter.take("search", 2, true).allowed).toBe(true);
  });

  test("an in-flight refusal does not also burn a token", () => {
    const clock = { now: 0 };
    const limiter = limiterAt(clock);

    limiter.take("search", 1, true);
    limiter.take("search", 1, true);
    limiter.take("search", 1, true);
    limiter.release("search", 1);

    // Only the first attempt consumed anything, so two of three remain.
    expect(limiter.take("search", 1).allowed).toBe(true);
    expect(limiter.take("search", 1).allowed).toBe(true);
    expect(limiter.take("search", 1).allowed).toBe(false);
  });
});
