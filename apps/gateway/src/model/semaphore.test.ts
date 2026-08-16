import { describe, expect, test } from "vitest";
import { Semaphore } from "./semaphore.ts";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("semaphore", () => {
  test("admits up to the limit", async () => {
    const semaphore = new Semaphore(2);
    await semaphore.acquire();
    await semaphore.acquire();
    expect(semaphore.held).toBe(2);
  });

  test("makes the next caller wait", async () => {
    const semaphore = new Semaphore(1);
    await semaphore.acquire();

    let entered = false;
    void semaphore.acquire().then(() => {
      entered = true;
    });

    await Promise.resolve();
    expect(entered).toBe(false);
  });

  test("never runs more than the limit, even when a caller arrives mid-handoff", async () => {
    // The bug this guards: release() decrements, then wakes a waiter. Between
    // the wake and the waiter's continuation, the count reads free — a caller
    // arriving in that window takes the slot as well, and both proceed. With a
    // limit of one that means two heavy processes at once.
    const semaphore = new Semaphore(1);
    let running = 0;
    let peak = 0;

    const gate = deferred();
    const work = async (wait: Promise<void>): Promise<void> => {
      await semaphore.acquire();
      running += 1;
      peak = Math.max(peak, running);
      await wait;
      running -= 1;
      semaphore.release();
    };

    const first = work(gate.promise);
    const second = work(Promise.resolve());
    // Arrives exactly while the permit is being handed over.
    const third = work(Promise.resolve());

    gate.resolve();
    await Promise.all([first, second, third]);

    expect(peak).toBe(1);
    expect(semaphore.held).toBe(0);
  });

  test("serialises a burst and lets everyone through", async () => {
    const semaphore = new Semaphore(1);
    const order: number[] = [];

    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        semaphore.run(async () => {
          order.push(n);
          await Promise.resolve();
        }),
      ),
    );

    expect(order).toHaveLength(4);
    expect(semaphore.held).toBe(0);
  });

  test("releases the permit when the work throws", async () => {
    const semaphore = new Semaphore(1);

    await expect(
      semaphore.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // Otherwise one failure would wedge the queue until a restart.
    expect(semaphore.held).toBe(0);
    await semaphore.acquire();
    expect(semaphore.held).toBe(1);
  });
});
