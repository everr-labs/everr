import { describe, expect, it } from "vitest";
import type { Instrumentation, InstrumentationContext } from "./runtime.js";
import { sampled } from "./sampled.js";

/**
 * A test context. It contains only the members that `sampled()` and the test
 * instrumentations use, which is `ids()` for the sampling decision. Each other
 * member throws an error when an instrumentation of a test reads it. Then that
 * test needs a more complete context and not this one.
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
    // In a large number of sessions, two instrumentations with different names
    // and the same rate must get different decisions a minimum of one time. Two
    // instrumentations with the same name, or with no name, get the same hash.
    // Then they get the same decision in each session.
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
