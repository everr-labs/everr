import { describe, expect, it } from "vitest";
import type { Plugin, PluginContext } from "./runtime.js";
import { sampled } from "./sampled.js";

/**
 * A context stub carrying only what `sampled()` and toy plugins under test
 * touch: `ids()` for the sampling decision. Any other member throws if a
 * test's plugin reaches for it, which would signal the test needs a fuller
 * fixture rather than this one.
 */
function fakeCtx(sessionId: string): PluginContext {
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
  it("rate 1 always runs the inner plugin, without consulting ids()", () => {
    let ran = false;
    const plugin: Plugin = () => {
      ran = true;
    };
    const ctx: PluginContext = {
      ...fakeCtx("s1"),
      ids: () => {
        throw new Error("ids() must not be called at rate 1");
      },
    };
    sampled(plugin, 1)(ctx);
    expect(ran).toBe(true);
  });

  it("rate 0 is a no-op: never runs, never consults ids()", () => {
    let ran = false;
    const plugin: Plugin = () => {
      ran = true;
    };
    const ctx: PluginContext = {
      ...fakeCtx("s1"),
      ids: () => {
        throw new Error("ids() must not be called at rate 0");
      },
    };
    sampled(plugin, 0)(ctx);
    expect(ran).toBe(false);
  });

  it("clamps rates outside [0, 1]", () => {
    let highRuns = 0;
    let lowRuns = 0;
    const high: Plugin = () => {
      highRuns++;
    };
    const low: Plugin = () => {
      lowRuns++;
    };
    sampled(high, 5)(fakeCtx("s1"));
    sampled(low, -5)(fakeCtx("s1"));
    expect(highRuns).toBe(1);
    expect(lowRuns).toBe(0);
  });

  it("is session-coherent: same session, same plugin, same decision every time", () => {
    let runs = 0;
    const plugin: Plugin = () => {
      runs++;
    };
    const wrapped = sampled(plugin, 0.5);
    for (let i = 0; i < 5; i++) wrapped(fakeCtx("stable-session"));
    expect(runs === 0 || runs === 5).toBe(true);
  });

  it("preserves the wrapped plugin's name", () => {
    const named = function pageviews(): void {};
    expect(sampled(named, 0.5).name).toBe("pageviews");
  });

  it("decorrelates differently-named plugins: they don't all land on the same side", () => {
    // Across many sessions, differently-named plugins wrapped at the same
    // rate should disagree at least once. A shared/empty name would hash
    // identically and make every plugin agree on every session.
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
        const plugin = {
          [name]: () => {
            ran = true;
          },
        }[name] as Plugin;
        sampled(plugin, 0.5)(ctx);
        return ran;
      });
      if (included.some(Boolean) && !included.every(Boolean)) disagreed = true;
    }
    expect(disagreed).toBe(true);
  });

  it("wraps a third-party (userland) plugin the same as a built-in", () => {
    let ran = false;
    const userland: Plugin = (ctx) => {
      ctx.ids();
      ran = true;
    };
    sampled(userland, 1)(fakeCtx("s1"));
    expect(ran).toBe(true);
  });

  it("returns the inner plugin's teardown when it runs", () => {
    const teardown = () => {};
    const plugin: Plugin = () => teardown;
    expect(sampled(plugin, 1)(fakeCtx("s1"))).toBe(teardown);
  });
});
