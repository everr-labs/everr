import { describe, expect, it } from "vite-plus/test";
import { createLimiter } from "./limiter";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
  let resolveFn!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolveFn = resolve;
  });
  return { promise, resolve: resolveFn };
}

describe("createLimiter", () => {
  it("never runs more than maxConcurrent tasks at once, and runs them all", async () => {
    const run = createLimiter(2);
    let active = 0;
    let maxActive = 0;
    const gates = [deferred<void>(), deferred<void>(), deferred<void>(), deferred<void>()];
    const results = gates.map((gate, i) =>
      run(undefined, async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await gate.promise;
        active--;
        return i;
      }),
    );

    await tick();
    expect(active).toBe(2); // only the first two started; the rest queued

    gates[0].resolve();
    await tick();
    expect(active).toBe(2); // a queued task took the freed slot

    gates[1].resolve();
    gates[2].resolve();
    gates[3].resolve();
    expect(await Promise.all(results)).toEqual([0, 1, 2, 3]);
    expect(maxActive).toBe(2);
  });

  it("skips an already-aborted task without running its work", async () => {
    const run = createLimiter(2);
    let ran = false;
    const controller = new AbortController();
    controller.abort();

    await expect(
      run(controller.signal, async () => {
        ran = true;
      }),
    ).rejects.toBeDefined();
    expect(ran).toBe(false);
  });

  it("a queued task still runs after earlier tasks finish", async () => {
    const run = createLimiter(1);
    const order: number[] = [];
    const first = deferred<void>();
    const p1 = run(undefined, async () => {
      order.push(1);
      await first.promise;
    });
    const p2 = run(undefined, async () => {
      order.push(2);
    });

    await tick();
    expect(order).toEqual([1]); // second is queued behind the single slot

    first.resolve();
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });
});
