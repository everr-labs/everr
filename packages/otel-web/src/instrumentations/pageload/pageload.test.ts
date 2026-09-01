import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTracer } from "../../pipeline/tracer.js";
import type { InstrumentationContext } from "../runtime.js";
import { sampled } from "../sampled.js";
import { pageLoad } from "./index.js";
import { startPageLoad } from "./pageload.js";

// The jsdom environment has no Resource Timing and no LoAF. Thus a replacement
// for PerformanceObserver keeps the function for each entry type, and the tests
// send the entries themselves. The tests also replace the timers, and thus they
// can examine the stop conditions: the load event plus settleMs, and ceilingMs.

type Recorded = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  start: number;
  end: number;
  duration: number;
  attrs: Record<string, unknown>;
};
// The children: the resources and the long animation frames.
let spans: Recorded[];
// The pageLoad root spans. The SDK sends the root when the window stops.
let roots: Recorded[];
let stop: () => void;

// The true tracer that sends its spans to a test function. A resource and a
// long animation frame are spans. The duration of the entry is the duration of
// the span.
const tracer = createTracer(
  (traceId, spanId, name, start, end, a, _error, parentSpanId) => {
    (name === "pageLoad" ? roots : spans).push({
      traceId,
      spanId,
      parentSpanId,
      name,
      start,
      end,
      duration: end - start,
      attrs: a,
    });
  },
);

const attrs = (i = 0) => spans[i].attrs;

type FakeResource = {
  entryType: string;
  name: string;
  initiatorType: string;
  startTime: number;
  duration: number;
  domainLookupStart: number;
  domainLookupEnd: number;
  connectStart: number;
  connectEnd: number;
  secureConnectionStart: number;
  requestStart: number;
  responseStart: number;
  responseEnd: number;
  transferSize: number;
  encodedBodySize: number;
  decodedBodySize: number;
  responseStatus?: number;
  renderBlockingStatus?: string;
  deliveryType?: string;
};

function entry(over: Partial<FakeResource>): FakeResource {
  return {
    entryType: "resource",
    name: "https://cdn.example.com/app.js",
    initiatorType: "script",
    startTime: 8.2,
    duration: 120.6,
    domainLookupStart: 10,
    domainLookupEnd: 14,
    connectStart: 14,
    connectEnd: 40,
    secureConnectionStart: 22,
    requestStart: 41,
    responseStart: 90,
    responseEnd: 130,
    transferSize: 5000,
    encodedBodySize: 4800,
    decodedBodySize: 12000,
    responseStatus: 200,
    ...over,
  };
}

type FakeLoaf = {
  entryType: string;
  startTime: number;
  duration: number;
  blockingDuration: number;
  styleAndLayoutStart: number;
  scripts: Array<{
    duration: number;
    forcedStyleAndLayoutDuration: number;
    sourceURL: string;
    sourceFunctionName: string;
    invokerType: string;
  }>;
};

function loaf(over?: Partial<FakeLoaf>): FakeLoaf {
  return {
    entryType: "long-animation-frame",
    startTime: 800.4,
    duration: 240.6,
    blockingDuration: 190.2,
    // The frame ends at 1041. Thus it has 30 ms of style and layout at the
    // end.
    styleAndLayoutStart: 1011,
    scripts: [
      {
        duration: 60,
        forcedStyleAndLayoutDuration: 0,
        sourceURL: "https://cdn.example.com/vendor.js",
        sourceFunctionName: "hydrate",
        invokerType: "classic-script",
      },
      {
        duration: 150.4,
        forcedStyleAndLayoutDuration: 0,
        sourceURL: "https://cdn.example.com/app.js",
        sourceFunctionName: "boot",
        invokerType: "module-script",
      },
    ],
    ...over,
  };
}

let observers: Map<string, (list: { getEntries: () => unknown[] }) => void>;
let buffered: boolean | undefined;
let disconnected: boolean;
// The entry types that the browser does not support.
let unsupported: Set<string>;
// The LCP entries that the browser did not deliver to the callback yet. The
// code gets them with takeRecords() when the window stops.
let pendingLcp: Array<{ startTime: number }>;
let loadEventEnd: number;
const TIME_ORIGIN = 1_700_000_000_000;

function stubTiming() {
  observers = new Map();
  buffered = undefined;
  disconnected = false;
  unsupported = new Set();
  pendingLcp = [];
  loadEventEnd = 0;
  class PO {
    cb: (list: { getEntries: () => unknown[] }) => void;
    type = "";
    constructor(cb: (list: { getEntries: () => unknown[] }) => void) {
      this.cb = cb;
    }
    observe(opts: { type: string; buffered?: boolean }) {
      if (unsupported.has(opts.type)) throw new TypeError("unsupported");
      buffered = opts.buffered;
      this.type = opts.type;
      observers.set(opts.type, this.cb);
    }
    takeRecords() {
      return this.type === "largest-contentful-paint" ? pendingLcp : [];
    }
    disconnect() {
      disconnected = true;
      observers.clear();
    }
  }
  vi.stubGlobal("PerformanceObserver", PO);
  vi.stubGlobal("performance", {
    timeOrigin: TIME_ORIGIN,
    getEntriesByType: (type: string) =>
      type === "navigation" && loadEventEnd ? [{ loadEventEnd }] : [],
  });
}

function feed(...entries: Partial<FakeResource>[]) {
  observers.get("resource")?.({ getEntries: () => entries.map(entry) });
}

function feedLoaf(...entries: FakeLoaf[]) {
  observers.get("long-animation-frame")?.({ getEntries: () => entries });
}

function feedLcp(...startTimes: number[]) {
  observers.get("largest-contentful-paint")?.({
    getEntries: () => startTimes.map((startTime) => ({ startTime })),
  });
}

function setReadyState(value: string) {
  Object.defineProperty(document, "readyState", { value, configurable: true });
}

// The hide listeners, as ctx.onHide of the SDK keeps them. The test calls
// hide() as the SDK does at pagehide and at the hidden state.
let hideListeners: Set<() => void>;
const onHide = (listener: () => void) => {
  hideListeners.add(listener);
  return () => hideListeners.delete(listener);
};
const hide = () => {
  for (const listener of hideListeners) listener();
};

beforeEach(() => {
  vi.useFakeTimers();
  spans = [];
  roots = [];
  hideListeners = new Set();
  setReadyState("loading");
  stubTiming();
});

afterEach(() => {
  stop?.();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const start = (settleMs = 3000, ceilingMs = 10000) => {
  stop = startPageLoad(tracer, onHide, settleMs, ceilingMs);
};

describe("asset waterfall", () => {
  it("observes resources buffered and emits one span per entry", () => {
    start();
    expect(buffered).toBe(true);
    feed({}, { name: "https://cdn.example.com/site.css?v=2" });
    expect(spans).toHaveLength(2);
    expect(spans[0].name).toBe("pageLoad.asset.script");
    expect(spans[1].name).toBe("pageLoad.asset.script");
  });

  it("names the span after the initiator type, never the URL", () => {
    // A URL with a content hash changes at each deployment. The name is the
    // same for each load, and the URL goes in url.full only.
    start();
    feed(
      { name: "https://cdn.example.com/app-8f3a2c.js" },
      { name: "https://cdn.example.com/site.css", initiatorType: "link" },
      { name: "https://cdn.example.com/hero.png", initiatorType: "img" },
    );
    expect(spans.map((s) => s.name)).toEqual([
      "pageLoad.asset.script",
      "pageLoad.asset.link",
      "pageLoad.asset.img",
    ]);
    expect(attrs(0)["url.full"]).toBe("https://cdn.example.com/app-8f3a2c.js");
  });

  it("puts the span at the entry time, from the time origin", () => {
    start();
    feed({ startTime: 8.2, duration: 120.6 });
    expect(spans[0].start).toBe(TIME_ORIGIN + 8);
    expect(spans[0].end).toBe(TIME_ORIGIN + 8 + 121);
  });

  it("maps timing, sizes, and semconv attributes", () => {
    start();
    feed({});
    expect(spans[0].duration).toBe(121);
    expect(attrs()).toMatchObject({
      "url.full": "https://cdn.example.com/app.js",
      "http.response.status_code": 200,
      "everr.browser.asset.initiator_type": "script",
      "everr.browser.asset.transfer_size": 5000,
      "everr.browser.asset.encoded_body_size": 4800,
      "everr.browser.asset.decoded_body_size": 12000,
      "everr.browser.asset.dns_duration": 4,
      "everr.browser.asset.connection_duration": 26,
      "everr.browser.asset.tls_duration": 18,
      "everr.browser.asset.request_duration": 49,
      "everr.browser.asset.download_duration": 40,
    });
  });

  it("strips query strings from url.full", () => {
    start();
    feed({ name: "https://cdn.example.com/img.png?token=secret" });
    expect(attrs()["url.full"]).toBe("https://cdn.example.com/img.png");
  });

  it("omits the origin for same-origin assets, keeps it cross-origin", () => {
    start();
    feed(
      { name: `${location.origin}/assets/main.js` },
      { name: "https://cdn.example.com/app.js" },
    );
    expect(attrs(0)["url.full"]).toBe("/assets/main.js");
    expect(attrs(1)["url.full"]).toBe("https://cdn.example.com/app.js");
  });

  it("excludes fetch and xhr entries", () => {
    start();
    feed(
      { initiatorType: "fetch" },
      { initiatorType: "xmlhttprequest" },
      { initiatorType: "img" },
    );
    expect(spans).toHaveLength(1);
    expect(attrs()["everr.browser.asset.initiator_type"]).toBe("img");
  });

  it("omits phases for cross-origin entries without Timing-Allow-Origin", () => {
    start();
    feed({
      responseStart: 0,
      requestStart: 0,
      domainLookupStart: 0,
      domainLookupEnd: 0,
      connectStart: 0,
      connectEnd: 0,
      secureConnectionStart: 0,
      transferSize: 0,
      responseStatus: 0,
    });
    const a = attrs();
    expect(a["everr.browser.asset.dns_duration"]).toBeUndefined();
    expect(a["everr.browser.asset.request_duration"]).toBeUndefined();
    expect(a["everr.browser.asset.download_duration"]).toBeUndefined();
    expect(a["http.response.status_code"]).toBeUndefined();
  });

  it("maps render blocking and delivery type when present", () => {
    start();
    feed({ renderBlockingStatus: "blocking", deliveryType: "cache" });
    expect(attrs()["everr.browser.asset.render_blocking"]).toBe(true);
    expect(attrs()["everr.browser.asset.delivery_type"]).toBe("cache");
  });
});

describe("long animation frames", () => {
  it("emits one span per frame with the longest script attributed", () => {
    start();
    feedLoaf(loaf());
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("pageLoad.long_animation_frame");
    expect(spans[0].duration).toBe(241);
    expect(attrs()).toMatchObject({
      "everr.browser.long_animation_frame.blocking_duration": 190,
      // The scripts are 60 and 150.4. The frame end 1041 minus
      // styleAndLayoutStart 1011 is 30. The value 240.6 minus 210.4 minus 30
      // rounds to 0.
      "everr.browser.long_animation_frame.script_duration": 210,
      "everr.browser.long_animation_frame.style_and_layout_duration": 30,
      "everr.browser.long_animation_frame.unattributed_duration": 0,
      "everr.browser.long_animation_frame.script.source_url":
        "https://cdn.example.com/app.js",
      "everr.browser.long_animation_frame.script.function_name": "boot",
      "everr.browser.long_animation_frame.script.invoker_type": "module-script",
      "everr.browser.long_animation_frame.script.duration": 150,
    });
  });

  it("carries no script attribution when the frame reports no scripts", () => {
    start();
    feedLoaf(loaf({ scripts: [] }));
    expect(spans[0].duration).toBe(241);
    expect(
      attrs()["everr.browser.long_animation_frame.script.source_url"],
    ).toBeUndefined();
    expect(attrs()["everr.browser.long_animation_frame.script_duration"]).toBe(
      0,
    );
    expect(
      attrs()["everr.browser.long_animation_frame.unattributed_duration"],
    ).toBe(211);
  });

  it("counts forced style/layout inside scripts as style-and-layout", () => {
    start();
    feedLoaf(
      loaf({
        scripts: [
          {
            duration: 150.4,
            forcedStyleAndLayoutDuration: 10,
            sourceURL: "https://cdn.example.com/app.js",
            sourceFunctionName: "boot",
            invokerType: "module-script",
          },
        ],
      }),
    );
    const a = attrs();
    expect(a["everr.browser.long_animation_frame.script_duration"]).toBe(140);
    expect(
      a["everr.browser.long_animation_frame.style_and_layout_duration"],
    ).toBe(40);
  });

  it("computes style-and-layout the same as web-vitals when the start is 0", () => {
    start();
    feedLoaf(loaf({ styleAndLayoutStart: 0, scripts: [] }));
    // A frame without a style-and-layout phase reports styleAndLayoutStart 0,
    // and the subtraction then spans from the time origin to the end of the
    // frame: 800.4 + 240.6 - 0 = 1041. The web-vitals attribution computes the
    // same value, and this module matches it on purpose.
    expect(
      attrs()["everr.browser.long_animation_frame.style_and_layout_duration"],
    ).toBe(1041);
  });

  it("still captures the waterfall when LoAF observation is unsupported", () => {
    unsupported.add("long-animation-frame");
    start();
    feed({});
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("pageLoad.asset.script");
  });

  it("stops with the same window as the waterfall", () => {
    start(3000, 10000);
    window.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(3000);
    feedLoaf(loaf());
    expect(spans).toHaveLength(0);
  });
});

describe("the pageLoad root", () => {
  it("is the parent of each resource and frame, in one trace", () => {
    start();
    feed({});
    feedLoaf(loaf());
    expect(roots).toHaveLength(0);
    stop();
    expect(roots).toHaveLength(1);
    const [root] = roots;
    expect(root.parentSpanId).toBeUndefined();
    expect(spans).toHaveLength(2);
    for (const child of spans) {
      expect(child.traceId).toBe(root.traceId);
      expect(child.parentSpanId).toBe(root.spanId);
    }
  });

  it("is the parent of any span of the SDK until its end, and none after", () => {
    // The request spans of the network signal, and each other span, use the
    // same tracer. A span that starts in the load joins the trace. A span
    // after the end of the root is its own trace.
    start();
    tracer.startSpan("GET /api/me").end();
    stop();
    tracer.startSpan("GET /api/later").end();
    const [inLoad, after] = spans;
    expect(inLoad.parentSpanId).toBe(roots[0].spanId);
    expect(inLoad.traceId).toBe(roots[0].traceId);
    expect(after.parentSpanId).toBeUndefined();
    expect(after.traceId).not.toBe(roots[0].traceId);
  });

  it("starts at the time origin and ends at the most recent LCP entry", () => {
    start();
    feedLcp(300.4, 1200.6);
    stop();
    expect(roots[0].start).toBe(TIME_ORIGIN);
    expect(roots[0].end).toBe(TIME_ORIGIN + 1201);
    expect(roots[0].attrs["everr.browser.page_load.end"]).toBe("lcp");
  });

  it("observes LCP buffered and reads the entries not delivered yet", () => {
    start();
    expect(observers.has("largest-contentful-paint")).toBe(true);
    feedLcp(300);
    pendingLcp = [{ startTime: 900 }];
    stop();
    expect(roots[0].end).toBe(TIME_ORIGIN + 900);
  });

  it("goes out when the window stops, at load + settleMs", () => {
    start(3000, 10000);
    feedLcp(500);
    window.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(2999);
    expect(roots).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(roots).toHaveLength(1);
    expect(roots[0].end).toBe(TIME_ORIGIN + 500);
  });

  it("ends at the load event when the browser has no LCP", () => {
    unsupported.add("largest-contentful-paint");
    loadEventEnd = 2500.2;
    start();
    feed({});
    stop();
    expect(spans[0].name).toBe("pageLoad.asset.script");
    expect(roots[0].end).toBe(TIME_ORIGIN + 2500);
    expect(roots[0].attrs["everr.browser.page_load.end"]).toBe("load");
  });

  it("ends now at the ceiling without an LCP and before the load event", () => {
    unsupported.add("largest-contentful-paint");
    vi.setSystemTime(TIME_ORIGIN + 10000);
    start(3000, 10000);
    vi.advanceTimersByTime(10000);
    expect(roots[0].end).toBe(TIME_ORIGIN + 20000);
    expect(roots[0].attrs["everr.browser.page_load.end"]).toBe("ceiling");
  });

  it("goes out when the page becomes hidden, before the window stops", () => {
    // A user who leaves early. The children went out already, and the root
    // must go out with the exit flush, or the trace has no root.
    start();
    feed({});
    feedLcp(400);
    hide();
    expect(roots).toHaveLength(1);
    expect(roots[0].end).toBe(TIME_ORIGIN + 400);
    // The LCP ended the root, even at the hidden event.
    expect(roots[0].attrs["everr.browser.page_load.end"]).toBe("lcp");
    // The window continues, but the root ended: a later resource is its own
    // trace.
    feed({});
    expect(spans[1].parentSpanId).toBeUndefined();
    expect(spans[1].traceId).not.toBe(roots[0].traceId);
  });

  it("says hidden when the page hides without an LCP and before load", () => {
    unsupported.add("largest-contentful-paint");
    start();
    hide();
    expect(roots).toHaveLength(1);
    expect(roots[0].attrs["everr.browser.page_load.end"]).toBe("hidden");
  });

  it("goes out one time only, and keeps the first end attribute", () => {
    unsupported.add("largest-contentful-paint");
    start();
    hide();
    hide();
    loadEventEnd = 900;
    stop();
    stop();
    expect(roots).toHaveLength(1);
    expect(roots[0].attrs["everr.browser.page_load.end"]).toBe("hidden");
  });

  it("removes its hide listener at teardown", () => {
    start();
    expect(hideListeners.size).toBe(1);
    stop();
    expect(hideListeners.size).toBe(0);
  });
});

describe("the load window", () => {
  it("stops at load + settleMs", () => {
    start(3000, 10000);
    window.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(2999);
    expect(disconnected).toBe(false);
    vi.advanceTimersByTime(1);
    expect(disconnected).toBe(true);
    feed({});
    expect(spans).toHaveLength(0);
  });

  it("stops at ceilingMs when load never fires", () => {
    start(3000, 10000);
    vi.advanceTimersByTime(10000);
    expect(disconnected).toBe(true);
  });

  it("starts the settle timer immediately when the document already loaded", () => {
    setReadyState("complete");
    start(3000, 10000);
    vi.advanceTimersByTime(3000);
    expect(disconnected).toBe(true);
  });

  it("teardown disconnects and clears timers", () => {
    start();
    stop();
    expect(disconnected).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("the pageLoad option", () => {
  // A small instrumentation context. The pageLoad code reads only the tracer
  // and the ids. The vitals are off, and thus no other observer registers.
  const ctx = (sessionId: string): InstrumentationContext =>
    ({
      tracer,
      onHide,
      ids: () => ({ visitorId: "v", sessionId }),
    }) as unknown as InstrumentationContext;

  const boot = (sample?: number, sessionId = "s-1") => {
    const instrumentation =
      sample === undefined ? pageLoad() : sampled(pageLoad(), sample);
    // A refused session gets no teardown: sampled() returns undefined.
    stop =
      (instrumentation(ctx(sessionId)) as (() => void) | undefined) ??
      (() => {});
  };

  it("pageLoad() opens the window with the defaults", () => {
    boot();
    expect(observers.has("resource")).toBe(true);
    feed({});
    expect(spans).toHaveLength(1);
  });

  it("samples the whole window per session, all-in or all-out", () => {
    // The decision comes from a hash, and thus it is always the same for one
    // session. In a large number of sessions, approximately the part `sample`
    // of them captures the data.
    let captured = 0;
    for (let i = 0; i < 100; i++) {
      stubTiming();
      boot(0.3, `session-${i}`);
      if (observers.has("resource")) captured++;
      stop();
    }
    expect(captured).toBeGreaterThan(10);
    expect(captured).toBeLessThan(50);

    stubTiming();
    boot(0.3, "session-0");
    const first = observers.has("resource");
    stop();
    stubTiming();
    boot(0.3, "session-0");
    expect(observers.has("resource")).toBe(first);
  });

  it("sample 0 never opens the window", () => {
    boot(0);
    expect(observers.has("resource")).toBe(false);
    stop = () => {};
  });
});

describe("script selection", () => {
  it("keeps the first script as culprit when later ones are shorter", () => {
    start();
    feedLoaf(
      loaf({
        scripts: [
          {
            duration: 150.4,
            forcedStyleAndLayoutDuration: 0,
            sourceURL: "https://cdn.example.com/app.js",
            sourceFunctionName: "boot",
            invokerType: "module-script",
          },
          {
            duration: 60,
            forcedStyleAndLayoutDuration: 0,
            sourceURL: "https://cdn.example.com/vendor.js",
            sourceFunctionName: "hydrate",
            invokerType: "classic-script",
          },
        ],
      }),
    );
    expect(
      attrs()["everr.browser.long_animation_frame.script.source_url"],
    ).toBe("https://cdn.example.com/app.js");
  });
});
