import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureError } from "../errors.js";
import {
  attrs,
  type OtlpBatch,
  type OtlpRecord,
  startClient,
} from "../test-kit.js";
import type { EverrClient, InitOptions } from "../types.js";
import { errors } from "./errors/index.js";
import { interactions } from "./interactions/index.js";
import { network } from "./network/index.js";
import { pageviews } from "./pageviews/index.js";
import { performance as performancePlugin } from "./performance/index.js";

// The built-in factories, composed explicitly: capture is opt-in only, so
// everything captured here comes through the plugins and the public
// PluginContext.

let client: EverrClient | undefined;
let batches: OtlpBatch[];

function start(options?: Partial<InitOptions>): void {
  [client, batches] = startClient({ plugins: [], ...options });
}

async function records(): Promise<OtlpRecord[]> {
  await client?.flush();
  return batches.flatMap((b) => b.records);
}

async function names(): Promise<string[]> {
  return (await records()).map((r) => r.eventName);
}

// The test-kit fetch stub only understands OTLP posts, so an app request
// throws inside the patched fetch; the span still records, and swallowing
// here keeps the test focused on the pipeline.
async function appFetch(url: string): Promise<void> {
  try {
    await fetch(url);
  } catch {
    // Expected: the stub is not an app backend.
  }
}

/** Dispatches an unhandled window error, swallowed for vitest's listener. */
function dispatchError(error: Error, filename?: string): void {
  const swallow = (event: Event) => event.preventDefault();
  window.addEventListener("error", swallow);
  try {
    window.dispatchEvent(
      new ErrorEvent("error", {
        error,
        message: error.message,
        filename,
        cancelable: true,
      }),
    );
  } finally {
    window.removeEventListener("error", swallow);
  }
}

afterEach(async () => {
  await client?.shutdown();
  client = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("pageviews()", () => {
  it("captures the initial view, SPA navigations, and the leave", async () => {
    start({ plugins: [pageviews()] });
    const [view] = await records();
    expect(view.eventName).toBe("everr.browser.page_view");
    expect(attrs(view)["everr.navigation.type"]).toBe("initial");
    const firstPageViewId = attrs(view)["everr.page_view.id"];

    history.pushState({}, "", "/next");
    const after = await records();
    expect(after.map((r) => r.eventName)).toEqual([
      "everr.browser.page_view",
      "everr.browser.page_leave",
      "everr.browser.page_view",
    ]);
    // The leave belongs to the page being left.
    const leave = attrs(after[1]);
    expect(leave["everr.page_view.id"]).toBe(firstPageViewId);
    expect(leave["everr.page_view.duration_ms"]).toBeDefined();
    const second = attrs(after[2]);
    expect(second["everr.navigation.type"]).toBe("history_change");
    expect(second["url.path"]).toBe("/next");
    expect(second["everr.page_view.id"]).not.toBe(firstPageViewId);
    history.pushState({}, "", "/");
  });

  it("stops navigating and leaving after teardown", async () => {
    start({ plugins: [pageviews()] });
    await client?.shutdown();
    const before = batches.flatMap((b) => b.records).length;
    history.pushState({}, "", "/gone");
    dispatchEvent(new Event("pagehide"));
    expect(batches.flatMap((b) => b.records)).toHaveLength(before);
    history.pushState({}, "", "/");
    client = undefined;
  });
});

describe("interactions()", () => {
  it("captures clicks with the element payload, and stops on shutdown", async () => {
    document.body.innerHTML = '<button id="go">Buy</button>';
    start({ plugins: [interactions()] });
    document.getElementById("go")?.click();
    const clicks = (await records()).filter(
      (r) => r.eventName === "everr.browser.interaction.click",
    );
    expect(clicks).toHaveLength(1);
    expect(attrs(clicks[0])["everr.element.selector"]).toBe("#go");

    await client?.shutdown();
    document.getElementById("go")?.click();
    expect(
      batches
        .flatMap((b) => b.records)
        .filter((r) => r.eventName === "everr.browser.interaction.click"),
    ).toHaveLength(1);
    client = undefined;
  });
});

describe("slow interactions ownership", () => {
  // The minimal Event Timing stub: enough for startInp's feature gate and
  // for driving one slow entry through the observer callback.
  let fire: ((entries: unknown[]) => void) | undefined;

  beforeEach(() => {
    fire = undefined;
    class FakePerformanceEventTiming {
      get interactionId() {
        return 0;
      }
    }
    class PO {
      cb: (list: { getEntries: () => unknown[] }) => void;
      constructor(cb: (list: { getEntries: () => unknown[] }) => void) {
        this.cb = cb;
      }
      observe(opts: { type: string }) {
        if (opts.type === "event") {
          fire = (entries) => this.cb({ getEntries: () => entries });
        }
      }
      takeRecords() {
        return [];
      }
      disconnect() {}
    }
    vi.stubGlobal("PerformanceEventTiming", FakePerformanceEventTiming);
    vi.stubGlobal("PerformanceObserver", PO);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const slowEntry = {
    entryType: "event",
    name: "click",
    interactionId: 7,
    target: null,
    startTime: 1000,
    duration: 300,
    processingStart: 1020,
    processingEnd: 1120,
  };

  it("performance() emits them", async () => {
    start({ plugins: [performancePlugin()] });
    fire?.([slowEntry]);
    vi.advanceTimersByTime(1_100);
    vi.useRealTimers();
    expect(await names()).toContain("everr.browser.slow_interaction");
  });

  it("interactions() does not", async () => {
    start({ plugins: [interactions()] });
    // interactions() never registers an Event Timing observer at all.
    expect(fire).toBeUndefined();
    vi.useRealTimers();
    expect(await names()).not.toContain("everr.browser.slow_interaction");
  });
});

describe("network()", () => {
  it("patches fetch, records request spans, and unpatches on shutdown", async () => {
    start({ plugins: [network()] });
    // startClient stubbed fetch before init, so the patch wrapped the stub;
    // shutdown must swap the patch back out for it.
    const patched = fetch;
    expect(vi.isMockFunction(patched)).toBe(false);
    await appFetch(`${location.origin}/api/users`);
    await client?.flush();
    const spans = batches.flatMap((b) => b.spans);
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("GET /api/users");
    expect(attrs(spans[0])["url.full"]).toBe(`${location.origin}/api/users`);
    expect(attrs(spans[0])["http.request.method"]).toBe("GET");

    await client?.shutdown();
    client = undefined;
    expect(fetch).not.toBe(patched);
    expect(vi.isMockFunction(fetch)).toBe(true);
  });
});

describe("errors()", () => {
  const boom = (message: string, stack?: string) => {
    const error = new Error(message);
    if (stack !== undefined) error.stack = stack;
    return error;
  };
  const exceptions = async () =>
    (await records()).filter((r) => r.eventName === "exception");

  it("reports unhandled window errors exactly once", async () => {
    start({ plugins: [errors()] });
    dispatchError(boom("kaboom"));
    const got = await exceptions();
    expect(got).toHaveLength(1);
    expect(attrs(got[0])["everr.error.handled"]).toBe(false);
    expect(attrs(got[0])["everr.error.mechanism"]).toBe("onerror");
  });

  it("removes the handlers on teardown", async () => {
    start({ plugins: [errors()] });
    await client?.shutdown();
    client = undefined;
    const before = batches.flatMap((b) => b.records).length;
    dispatchError(boom("late"));
    expect(batches.flatMap((b) => b.records)).toHaveLength(before);
  });

  it("ignore drops matching messages from every error path", async () => {
    start({
      plugins: [errors({ ignore: ["ResizeObserver", /^Script error/] })],
    });
    // Manual captureError is gated too, as a silent success.
    captureError(boom("ResizeObserver loop limit exceeded"));
    captureError(boom("Script error."));
    dispatchError(boom("ResizeObserver loop completed"));
    captureError(boom("a real problem"));
    const got = await exceptions();
    expect(got).toHaveLength(1);
    expect(attrs(got[0])["exception.message"]).toBe("a real problem");
  });

  it("denyUrls drops by the top stack frame's script url", async () => {
    start({ plugins: [errors({ denyUrls: ["cdn.widget.example"] })] });
    captureError(
      boom(
        "widget exploded",
        "Error: widget exploded\n    at render (https://cdn.widget.example/w.js:1:2)",
      ),
    );
    // Firefox frame shape, no message line.
    captureError(
      boom("gecko widget", "render@https://cdn.widget.example/w.js:1:2"),
    );
    // A url:line:col inside the MESSAGE line is not a frame: this error
    // comes from our own bundle and must not be denied.
    captureError(
      boom(
        "Failed to load https://cdn.widget.example/chunk.js:1:2",
        "Error: Failed to load https://cdn.widget.example/chunk.js:1:2\n    at main (https://app.example/bundle.js:1:2)",
      ),
    );
    captureError(
      boom(
        "ours",
        "Error: ours\n    at main (https://app.example/bundle.js:1:2)",
      ),
    );
    const got = await exceptions();
    expect(got.map((r) => attrs(r)["exception.message"])).toEqual([
      "Failed to load https://cdn.widget.example/chunk.js:1:2",
      "ours",
    ]);
  });

  it("denyUrls falls back to the handler filename, and no url means no match", async () => {
    start({ plugins: [errors({ denyUrls: [/evil\.example/] })] });
    dispatchError(
      boom("from third party", "no frames here"),
      "https://evil.example/inject.js",
    );
    // No stack url and no filename: denyUrls cannot match, the error ships.
    captureError(boom("bare", "no frames here"));
    const got = await exceptions();
    expect(got).toHaveLength(1);
    expect(attrs(got[0])["exception.message"]).toBe("bare");
  });

  it("without errors() no declarative filtering exists", async () => {
    start();
    captureError(boom("ResizeObserver loop limit exceeded"));
    expect(await exceptions()).toHaveLength(1);
  });

  it("teardown unregisters the filters", async () => {
    start({ plugins: [errors({ ignore: ["flaky"] })] });
    await client?.shutdown();
    start({ plugins: [errors()] });
    captureError(boom("flaky thing"));
    expect(await exceptions()).toHaveLength(1);
  });
});

describe("composing all five", () => {
  it("reproduces today's capture through the public context", async () => {
    document.body.innerHTML = '<button id="all">Go</button>';
    start({
      plugins: [
        errors(),
        pageviews(),
        interactions(),
        performancePlugin(),
        network(),
      ],
    });
    document.getElementById("all")?.click();
    dispatchError(new Error("oops"));
    await appFetch(`${location.origin}/api/x`);

    const got = await names();
    expect(got.filter((n) => n === "everr.browser.page_view")).toHaveLength(1);
    expect(
      got.filter((n) => n === "everr.browser.interaction.click"),
    ).toHaveLength(1);
    expect(got.filter((n) => n === "exception")).toHaveLength(1);
    expect(batches.flatMap((b) => b.spans)).toHaveLength(1);

    // Full unpatch: fetch restored, no listener emits anything anymore.
    await client?.shutdown();
    client = undefined;
    const before = batches.flatMap((b) => b.records).length;
    document.getElementById("all")?.click();
    history.pushState({}, "", "/away");
    dispatchError(new Error("late"));
    dispatchEvent(new Event("pagehide"));
    expect(batches.flatMap((b) => b.records)).toHaveLength(before);
    history.pushState({}, "", "/");
  });
});
