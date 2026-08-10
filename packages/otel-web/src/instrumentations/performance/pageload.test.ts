import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTracer } from "../../tracer.js";
import type { InstrumentationContext } from "../runtime.js";
import { performance as performanceInstrumentation } from "./index.js";
import { startPageLoad } from "./pageload.js";

// jsdom has no Resource Timing and no LoAF: a stub PerformanceObserver
// captures the per-type callbacks and the tests drive entries by hand.
// Timers are faked to walk the load + settle / ceiling stop logic.

let spans: Array<{
  name: string;
  duration: number;
  attrs: Record<string, unknown>;
}>;
let stop: () => void;

// The real tracer over a capturing span sink: assets and long animation
// frames are spans, with the entry's duration as the span duration.
const tracer = createTracer((_traceId, _spanId, name, start, end, a) => {
  spans.push({ name, duration: end - start, attrs: a });
});

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
    // Frame ends at 1041: 30ms of trailing style-and-layout.
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
let loafThrows: boolean;

function stubTiming() {
  observers = new Map();
  buffered = undefined;
  disconnected = false;
  loafThrows = false;
  class PO {
    cb: (list: { getEntries: () => unknown[] }) => void;
    constructor(cb: (list: { getEntries: () => unknown[] }) => void) {
      this.cb = cb;
    }
    observe(opts: { type: string; buffered?: boolean }) {
      if (opts.type === "long-animation-frame" && loafThrows)
        throw new TypeError("unsupported");
      buffered = opts.buffered;
      observers.set(opts.type, this.cb);
    }
    takeRecords() {
      return [];
    }
    disconnect() {
      disconnected = true;
      observers.clear();
    }
  }
  vi.stubGlobal("PerformanceObserver", PO);
}

function feed(...entries: Partial<FakeResource>[]) {
  observers.get("resource")?.({ getEntries: () => entries.map(entry) });
}

function feedLoaf(...entries: FakeLoaf[]) {
  observers.get("long-animation-frame")?.({ getEntries: () => entries });
}

function setReadyState(value: string) {
  Object.defineProperty(document, "readyState", { value, configurable: true });
}

beforeEach(() => {
  vi.useFakeTimers();
  spans = [];
  setReadyState("loading");
  stubTiming();
});

afterEach(() => {
  stop?.();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const start = (settleMs = 3000, ceilingMs = 10000) => {
  stop = startPageLoad(tracer, settleMs, ceilingMs);
};

describe("asset waterfall", () => {
  it("observes resources buffered and emits one span per entry", () => {
    start();
    expect(buffered).toBe(true);
    feed({}, { name: "https://cdn.example.com/site.css?v=2" });
    expect(spans).toHaveLength(2);
    expect(spans[0].name).toBe("GET https://cdn.example.com/app.js");
    // The name is query-stripped like url.full.
    expect(spans[1].name).toBe("GET https://cdn.example.com/site.css");
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
    expect(spans[0].name).toBe("GET /assets/main.js");
    expect(attrs(0)["url.full"]).toBe("/assets/main.js");
    expect(spans[1].name).toBe("GET https://cdn.example.com/app.js");
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
    expect(spans[0].name).toBe("long_animation_frame");
    expect(spans[0].duration).toBe(241);
    expect(attrs()).toMatchObject({
      "everr.browser.long_animation_frame.blocking_duration": 190,
      // scripts 60 + 150.4; frame end 1041 - styleAndLayoutStart 1011 = 30;
      // 240.6 - 210.4 - 30 rounds to 0.
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

  it("reports no style-and-layout when the frame had no such phase", () => {
    start();
    feedLoaf(loaf({ styleAndLayoutStart: 0, scripts: [] }));
    expect(
      attrs()["everr.browser.long_animation_frame.style_and_layout_duration"],
    ).toBe(0);
  });

  it("still captures the waterfall when LoAF observation is unsupported", () => {
    loafThrows = true;
    start();
    feed({});
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("GET https://cdn.example.com/app.js");
  });

  it("stops with the same window as the waterfall", () => {
    start(3000, 10000);
    window.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(3000);
    feedLoaf(loaf());
    expect(spans).toHaveLength(0);
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
  // A minimal instrumentation context: only the tracer and ids are consulted
  // by the pageLoad path; the vitals are disabled so no other observer
  // registers.
  const ctx = (sessionId: string): InstrumentationContext =>
    ({
      tracer,
      ids: () => ({ visitorId: "v", sessionId }),
    }) as unknown as InstrumentationContext;

  const boot = (pageLoad: boolean | { sample?: number }, sessionId = "s-1") => {
    stop = performanceInstrumentation({
      webVitals: [],
      slowInteractions: false,
      pageLoad,
    })(ctx(sessionId)) as () => void;
  };

  it("is on by default: performance() opens the load window", () => {
    stop = performanceInstrumentation({
      webVitals: [],
      slowInteractions: false,
    })(ctx("s-1")) as () => void;
    expect(observers.has("resource")).toBe(true);
  });

  it("pageLoad: false opens no load window", () => {
    stop = performanceInstrumentation({
      webVitals: [],
      slowInteractions: false,
      pageLoad: false,
    })(ctx("s-1")) as () => void;
    expect(observers.has("resource")).toBe(false);
  });

  it("pageLoad: true opens the window with the defaults", () => {
    boot(true);
    expect(observers.has("resource")).toBe(true);
    feed({});
    expect(spans).toHaveLength(1);
  });

  it("samples the whole window per session, all-in or all-out", () => {
    // The decision is a deterministic hash: across many sessions roughly
    // `sample` of them capture, and a given session always decides the same.
    let captured = 0;
    for (let i = 0; i < 100; i++) {
      stubTiming();
      boot({ sample: 0.3 }, `session-${i}`);
      if (observers.has("resource")) captured++;
      stop();
    }
    expect(captured).toBeGreaterThan(10);
    expect(captured).toBeLessThan(50);

    stubTiming();
    boot({ sample: 0.3 }, "session-0");
    const first = observers.has("resource");
    stop();
    stubTiming();
    boot({ sample: 0.3 }, "session-0");
    expect(observers.has("resource")).toBe(first);
  });

  it("sample 0 never opens the window", () => {
    boot({ sample: 0 });
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
