import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSDK } from "../client.js";
import { captureError } from "../errors.js";
import {
  allInstrumentations,
  attrs,
  type OtlpBatch,
  type OtlpRecord,
  startClient,
} from "../test-kit.js";
import type { WebSDKOptions } from "../types.js";
import { errors } from "./errors/index.js";
import { interactions } from "./interactions/index.js";
import { network } from "./network/index.js";
import { pageviews } from "./pageviews/index.js";
import { performance as performanceInstrumentation } from "./performance/index.js";

// The built-in factories, composed explicitly: capture is opt-in only, so
// everything captured here comes through the instrumentations and the public
// InstrumentationContext.

let client: WebSDK | undefined;
let batches: OtlpBatch[];

function start(options?: Partial<WebSDKOptions>): void {
  [client, batches] = startClient({ instrumentations: [], ...options });
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
    start({ instrumentations: [pageviews()] });
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
    expect(leave["everr.page_view.duration"]).toBeDefined();
    const second = attrs(after[2]);
    expect(second["everr.navigation.type"]).toBe("history_change");
    expect(second["url.path"]).toBe("/next");
    expect(second["everr.page_view.id"]).not.toBe(firstPageViewId);
    history.pushState({}, "", "/");
  });

  it("stops navigating and leaving after teardown", async () => {
    start({ instrumentations: [pageviews()] });
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
    start({ instrumentations: [interactions()] });
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
    start({ instrumentations: [performanceInstrumentation()] });
    fire?.([slowEntry]);
    vi.advanceTimersByTime(1_100);
    vi.useRealTimers();
    expect(await names()).toContain("everr.browser.slow_interaction");
  });

  it("interactions() does not", async () => {
    start({ instrumentations: [interactions()] });
    // interactions() never registers an Event Timing observer at all.
    expect(fire).toBeUndefined();
    vi.useRealTimers();
    expect(await names()).not.toContain("everr.browser.slow_interaction");
  });
});

describe("performance({ pageLoad })", () => {
  it("emits a record per resource entry and stops after runtime teardown", async () => {
    let fire: ((entries: unknown[]) => void) | undefined;
    class PO {
      cb: (list: { getEntries: () => unknown[] }) => void;
      constructor(cb: (list: { getEntries: () => unknown[] }) => void) {
        this.cb = cb;
      }
      observe(opts: { type: string }) {
        if (opts.type === "resource") {
          fire = (entries) => this.cb({ getEntries: () => entries });
        }
      }
      takeRecords() {
        return [];
      }
      disconnect() {
        fire = undefined;
      }
    }
    vi.stubGlobal("PerformanceObserver", PO);
    start({
      instrumentations: [
        performanceInstrumentation({
          webVitals: [],
          slowInteractions: false,
          pageLoad: true,
        }),
      ],
    });
    fire?.([
      {
        entryType: "resource",
        name: "https://cdn.example.com/app.js?v=1",
        initiatorType: "script",
        duration: 120,
        domainLookupStart: 0,
        domainLookupEnd: 0,
        connectStart: 0,
        connectEnd: 0,
        secureConnectionStart: 0,
        requestStart: 0,
        responseStart: 0,
        responseEnd: 130,
        transferSize: 5000,
        encodedBodySize: 4800,
        decodedBodySize: 12000,
      },
    ]);
    const [record] = (await records()).filter(
      (r) => r.eventName === "everr.browser.asset",
    );
    expect(attrs(record)["url.full"]).toBe("https://cdn.example.com/app.js");
    // The envelope stamps the shared session context on asset records too.
    expect(attrs(record)["session.id"]).toBeDefined();
    await client?.shutdown();
    client = undefined;
    expect(fire).toBeUndefined();
  });
});

describe("network()", () => {
  it("patches fetch, records request spans, and unpatches on shutdown", async () => {
    start({ instrumentations: [network()] });
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
    start({ instrumentations: [errors()] });
    dispatchError(boom("kaboom"));
    const got = await exceptions();
    expect(got).toHaveLength(1);
    expect(attrs(got[0])["everr.error.handled"]).toBe(false);
    expect(attrs(got[0])["everr.error.mechanism"]).toBe("onerror");
  });

  it("removes the handlers on teardown", async () => {
    start({ instrumentations: [errors()] });
    await client?.shutdown();
    client = undefined;
    const before = batches.flatMap((b) => b.records).length;
    dispatchError(boom("late"));
    expect(batches.flatMap((b) => b.records)).toHaveLength(before);
  });

  it("ignore drops matching messages from every error path", async () => {
    start({
      instrumentations: [
        errors({ ignore: ["ResizeObserver", /^Script error/] }),
      ],
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
    start({ instrumentations: [errors({ denyUrls: ["cdn.widget.example"] })] });
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
    start({ instrumentations: [errors({ denyUrls: [/evil\.example/] })] });
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
    start({ instrumentations: [errors({ ignore: ["flaky"] })] });
    await client?.shutdown();
    start({ instrumentations: [errors()] });
    captureError(boom("flaky thing"));
    expect(await exceptions()).toHaveLength(1);
  });
});

describe("composing all five", () => {
  it("reproduces today's capture through the public context", async () => {
    document.body.innerHTML = '<button id="all">Go</button>';
    start({ instrumentations: allInstrumentations() });
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

describe("capture guards and page context", () => {
  it("interactions() ignores events whose target is not an element", async () => {
    start({ instrumentations: [interactions()] });
    document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(await names()).not.toContain("everr.browser.interaction.click");
  });

  it("pageviews() reports the deepest scroll against the real page height", async () => {
    start({ instrumentations: [pageviews()] });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      value: 2_000,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 500,
      configurable: true,
    });
    Object.defineProperty(window, "scrollY", {
      value: 500,
      configurable: true,
    });
    dispatchEvent(new Event("scroll"));
    // Scrolling back up must not shrink the recorded depth.
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    dispatchEvent(new Event("scroll"));
    // A visibilitychange that stays visible is not a leave.
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    dispatchEvent(new Event("visibilitychange"));
    expect(await names()).not.toContain("everr.browser.page_leave");
    dispatchEvent(new Event("pagehide"));
    const leave = (await records()).find(
      (r) => r.eventName === "everr.browser.page_leave",
    );
    expect(attrs(leave as OtlpRecord)["everr.scroll.depth"]).toBe(0.5);
  });
});

describe("errors() edge wiring", () => {
  it("ignores error events that carry no error object", async () => {
    start({ instrumentations: [errors()] });
    const swallow = (event: Event) => event.preventDefault();
    window.addEventListener("error", swallow);
    try {
      window.dispatchEvent(
        new ErrorEvent("error", { message: "no object", cancelable: true }),
      );
    } finally {
      window.removeEventListener("error", swallow);
    }
    expect(await names()).not.toContain("exception");
  });

  it("consults denyUrls with no url at all for stackless non-Error captures", async () => {
    start({ instrumentations: [errors({ denyUrls: ["blocked.example"] })] });
    captureError("stackless string failure");
    const got = (await records()).filter((r) => r.eventName === "exception");
    expect(got).toHaveLength(1);
    expect(attrs(got[0])["exception.message"]).toBe("stackless string failure");
  });

  it("a newer init's filters win the slot; the older teardown leaves them", async () => {
    start({ instrumentations: [errors({ ignore: ["from-first"] })] });
    const first = client;
    const [second, secondBatches] = (
      await import("../test-kit.js")
    ).startClient({ instrumentations: [errors({ ignore: ["from-second"] })] });
    // The older client's shutdown must not unregister the newer filter (it
    // does unbind the shared pipeline, so a fresh init rebinds it).
    await first?.shutdown();
    void secondBatches;
    // A fresh init rebinds the pipeline the first shutdown unbound; the
    // second client's filter must still be the one in the slot.
    start({ instrumentations: [] });
    captureError(new Error("from-second: dropped"));
    captureError(new Error("from-first: no longer filtered"));
    const got = (await records()).filter((r) => r.eventName === "exception");
    expect(got).toHaveLength(1);
    expect(attrs(got[0])["exception.message"]).toBe(
      "from-first: no longer filtered",
    );
    await second.shutdown();
  });
});

describe("frame-url parsing precision", () => {
  it("passes the exact frame url to RegExp deny rules, line and column stripped", async () => {
    // An end-anchored RegExp matcher only works if frameUrl strips the
    // multi-digit :line:column exactly; a sloppier parse leaks digits into
    // the url and the rule stops matching.
    start({ instrumentations: [errors({ denyUrls: [/w\.js$/] })] });
    const denied = new Error("widget exploded");
    denied.stack =
      "Error: widget exploded\n    at render (https://cdn.widget.example/w.js:10:25)";
    captureError(denied);
    // A frame with no :line:column is not a frame; nothing is denied.
    const kept = new Error("bare frame");
    kept.stack = "Error: bare frame\n    at https://cdn.widget.example/w.js";
    captureError(kept);
    const got = (await records()).filter((r) => r.eventName === "exception");
    expect(got).toHaveLength(1);
    expect(attrs(got[0])["exception.message"]).toBe("bare frame");
  });
});

describe("frame-url parsing, remaining shapes", () => {
  it("recognizes bare and anonymous frames, only at line starts, only whole lines", async () => {
    start({ instrumentations: [errors({ denyUrls: ["cdn.widget.example"] })] });
    // Chrome bare frame: no function name, no parentheses.
    const bare = new Error("bare");
    bare.stack = "Error: bare\n    at https://cdn.widget.example/w.js:1:2";
    captureError(bare);
    // Firefox anonymous frame: nothing before the @.
    const anon = new Error("anon");
    anon.stack = "@https://cdn.widget.example/w.js:1:2";
    captureError(anon);
    // " at url:line:col" inside a message line is not a frame.
    const message = new Error("failed at https://cdn.widget.example/w.js:1:2");
    message.stack =
      "Error: failed at https://cdn.widget.example/w.js:1:2\n    at main (https://app.example/bundle.js:1:2)";
    captureError(message);
    // Trailing junk after the column disqualifies the line as a frame.
    const trailing = new Error("trailing");
    trailing.stack =
      "Error: trailing\n    at https://cdn.widget.example/w.js:1:2 [native]";
    captureError(trailing);
    const kept = (await records())
      .filter((r) => r.eventName === "exception")
      .map((r) => attrs(r)["exception.message"]);
    expect(kept).toEqual([
      "failed at https://cdn.widget.example/w.js:1:2",
      "trailing",
    ]);
  });
});
