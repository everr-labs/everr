import { describe, expect, it } from "vitest";
import type { Instrumentation, InstrumentationContext } from "./runtime.js";
import { sampled } from "./sampled.js";

/**
 * A context stub carrying only what `sampled()` and toy instrumentations under test
 * touch: `ids()` for the sampling decision. Any other member throws if a
 * test's instrumentation reaches for it, which would signal the test needs a fuller
 * fixture rather than this one.
 */
function fakeCtx(sessionId: string): InstrumentationContext {
  return {
    ids: () => ({ sessionId, visitorId: "v" }),
    emit: () => {
      throw new Error("emit unused by these tests");
    },
    tracer: undefined as never,
    route: () => null,
    page: undefined as never,
    onNavigation: () => () => {},
    dev: false,
  };
}

describe("sampled()", () => {
  it("rate 1 always runs the inner instrumentation, without consulting ids()", () => {
    let ran = false;
    const instrumentation: Instrumentation = () => {
      ran = true;
    };
    const ctx: InstrumentationContext = {
      ...fakeCtx("s1"),
      ids: () => {
        throw new Error("ids() must not be called at rate 1");
      },
    };
    sampled(instrumentation, 1)(ctx);
    expect(ran).toBe(true);
  });

  it("rate 0 is a no-op: never runs, never consults ids()", () => {
    let ran = false;
    const instrumentation: Instrumentation = () => {
      ran = true;
    };
    const ctx: InstrumentationContext = {
      ...fakeCtx("s1"),
      ids: () => {
        throw new Error("ids() must not be called at rate 0");
      },
    };
    sampled(instrumentation, 0)(ctx);
    expect(ran).toBe(false);
  });

  it("clamps rates outside [0, 1]", () => {
    let highRuns = 0;
    let lowRuns = 0;
    const high: Instrumentation = () => {
      highRuns++;
    };
    const low: Instrumentation = () => {
      lowRuns++;
    };
    sampled(high, 5)(fakeCtx("s1"));
    sampled(low, -5)(fakeCtx("s1"));
    expect(highRuns).toBe(1);
    expect(lowRuns).toBe(0);
  });

  it("is session-coherent: same session, same instrumentation, same decision every time", () => {
    let runs = 0;
    const instrumentation: Instrumentation = () => {
      runs++;
    };
    const wrapped = sampled(instrumentation, 0.5);
    for (let i = 0; i < 5; i++) wrapped(fakeCtx("stable-session"));
    expect(runs === 0 || runs === 5).toBe(true);
  });

  it("preserves the wrapped instrumentation's name", () => {
    const named = function pageviews(): void {};
    expect(sampled(named, 0.5).name).toBe("pageviews");
  });

  it("decorrelates differently-named instrumentations: they don't all land on the same side", () => {
    // Across many sessions, differently-named instrumentations wrapped at the same
    // rate should disagree at least once. A shared/empty name would hash
    // identically and make every instrumentation agree on every session.
    const names = [
      "pageviews",
      "interactions",
      "network",
      "performance",
      "errors",
    ];
    let disagreed = false;
    for (let session = 0; session < 20 && !disagreed; session++) {
      const ctx = fakeCtx(`session-${session}`);
      const included = names.map((name) => {
        let ran = false;
        const instrumentation = {
          [name]: () => {
            ran = true;
          },
        }[name] as Instrumentation;
        sampled(instrumentation, 0.5)(ctx);
        return ran;
      });
      if (included.some(Boolean) && !included.every(Boolean)) disagreed = true;
    }
    expect(disagreed).toBe(true);
  });

  it("wraps a third-party (userland) instrumentation the same as a built-in", () => {
    let ran = false;
    const userland: Instrumentation = (ctx) => {
      ctx.ids();
      ran = true;
    };
    sampled(userland, 1)(fakeCtx("s1"));
    expect(ran).toBe(true);
  });

  it("returns the inner instrumentation's teardown when it runs", () => {
    const teardown = () => {};
    const instrumentation: Instrumentation = () => teardown;
    expect(sampled(instrumentation, 1)(fakeCtx("s1"))).toBe(teardown);
  });
});
