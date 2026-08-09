import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSDK } from "../../client.js";
import type { Emit } from "../../emitter.js";
import {
  attrs,
  type OtlpBatch,
  startClient,
  UNIQUE_ID,
} from "../../test-kit.js";
import { startWebVitals } from "./webvitals.js";

// jsdom produces no PerformanceObserver entries and no navigation/paint/
// resource timeline: the tests stub PerformanceObserver (capturing the
// per-type callbacks) and the performance global (serving configured
// entries per type), then drive entries by hand: the coverage the
// web-vitals library's e2e suite provided, ported to the in-house
// implementation.

let emitted: Array<{ name: string; attrs?: Record<string, unknown> }>;
let stop: () => void;

const emit: Emit = (name, a) => {
  emitted.push({ name, attrs: a });
};

const vitals = (name?: string) =>
  emitted.filter(
    (e) =>
      e.name === "browser.web_vital" &&
      (!name || e.attrs?.["browser.web_vital.name"] === name),
  );

// --- the fake performance timeline ---

let perfEntries: Record<string, unknown[]>;
let nowMs: number;

const nav = (over?: Record<string, unknown>) => ({
  type: "navigate",
  activationStart: 0,
  responseStart: 120.5,
  workerStart: 0,
  fetchStart: 10,
  domainLookupStart: 10,
  connectStart: 15,
  connectEnd: 35,
  domInteractive: 300,
  domContentLoadedEventStart: 400,
  domComplete: 500,
  ...over,
});

const fcp = (startTime = 50) => ({
  name: "first-contentful-paint",
  startTime,
});

// --- the fake observer registry ---

let observers: Map<string, (list: { getEntries: () => unknown[] }) => void>;
let observeThrows: boolean;
let inputListeners: Map<string, Set<EventListener>>;

function stubTiming() {
  observers = new Map();
  observeThrows = false;
  // jsdom-dispatched events are never isTrusted and the property cannot be
  // faked on an instance: the input listeners are captured through an
  // addEventListener wrapper and driven with hand-built events instead.
  inputListeners = new Map();
  const realAdd = window.addEventListener.bind(window);
  const realRemove = window.removeEventListener.bind(window);
  vi.stubGlobal(
    "addEventListener",
    (type: string, fn: EventListener, opts?: unknown) => {
      if (type === "click" || type === "keydown") {
        if (!inputListeners.has(type)) inputListeners.set(type, new Set());
        inputListeners.get(type)?.add(fn);
      }
      realAdd(type, fn, opts as AddEventListenerOptions);
    },
  );
  vi.stubGlobal(
    "removeEventListener",
    (type: string, fn: EventListener, opts?: unknown) => {
      inputListeners.get(type)?.delete(fn);
      realRemove(type, fn, opts as EventListenerOptions);
    },
  );
  perfEntries = { navigation: [nav()] };
  nowMs = 10_000;
  class PO {
    cb: (list: { getEntries: () => unknown[] }) => void;
    types: string[] = [];
    constructor(cb: (list: { getEntries: () => unknown[] }) => void) {
      this.cb = cb;
    }
    observe(opts: { type: string }) {
      if (observeThrows) throw new TypeError("unsupported");
      this.types.push(opts.type);
      observers.set(opts.type, this.cb);
    }
    takeRecords() {
      return [];
    }
    disconnect() {
      for (const t of this.types) observers.delete(t);
    }
  }
  vi.stubGlobal("PerformanceObserver", PO);
  vi.stubGlobal("performance", {
    now: () => nowMs,
    getEntriesByType: (type: string) => perfEntries[type] ?? [],
  });
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) =>
    setTimeout(cb, 16),
  );
}

function fire(type: string, entries: unknown[]) {
  observers.get(type)?.({ getEntries: () => entries });
}

const lcpEntry = (over?: Record<string, unknown>) => ({
  startTime: 1_000,
  url: "",
  element: null,
  id: "",
  ...over,
});

const shift = (over?: Record<string, unknown>) => ({
  startTime: 1_000,
  value: 0.1,
  hadRecentInput: false,
  sources: [],
  ...over,
});

function setVisibility(value: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    value,
    configurable: true,
  });
}

function hide(at = 9_000) {
  setVisibility("hidden");
  const event = new Event("visibilitychange", { bubbles: true });
  Object.defineProperty(event, "timeStamp", { value: at });
  document.dispatchEvent(event);
}

function click(trusted = true) {
  for (const fn of [...(inputListeners.get("click") ?? [])]) {
    fn({ isTrusted: trusted, type: "click" } as Event);
  }
  // The LCP finalization defers via the idle path (setTimeout fallback).
  vi.advanceTimersByTime(0);
}

function restore(at = 5_000) {
  setVisibility("visible");
  const pageshow = new Event("pageshow");
  Object.defineProperty(pageshow, "persisted", { value: true });
  Object.defineProperty(pageshow, "timeStamp", { value: at });
  window.dispatchEvent(pageshow);
}

function start(list: Array<"lcp" | "cls" | "ttfb"> = ["lcp", "cls", "ttfb"]) {
  stop();
  emitted = [];
  stop = startWebVitals(emit, list);
}

beforeEach(() => {
  vi.useFakeTimers();
  emitted = [];
  document.body.innerHTML = "";
  setVisibility("visible");
  stubTiming();
  stop = startWebVitals(emit, ["lcp", "cls", "ttfb"]);
});

afterEach(() => {
  stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ttfb", () => {
  it("reports responseStart with the subpart durations", () => {
    vi.advanceTimersByTime(0);
    const [record] = vitals("ttfb");
    const a = record.attrs ?? {};
    expect(a["browser.web_vital.value"]).toBe(120.5);
    expect(a["browser.web_vital.delta"]).toBe(120.5);
    expect(a["browser.web_vital.id"]).toMatch(UNIQUE_ID);
    expect(a["everr.browser.web_vital.rating"]).toBe("good");
    expect(a["everr.browser.web_vital.navigation_type"]).toBe("navigate");
    expect(a["everr.browser.web_vital.ttfb.waiting_duration"]).toBe(10);
    expect(a["everr.browser.web_vital.ttfb.cache_duration"]).toBe(0);
    expect(a["everr.browser.web_vital.ttfb.dns_duration"]).toBe(5);
    expect(a["everr.browser.web_vital.ttfb.connection_duration"]).toBe(20);
    expect(a["everr.browser.web_vital.ttfb.request_duration"]).toBe(85.5);
  });

  it("counts service worker startup as cache time via workerStart", () => {
    perfEntries.navigation = [nav({ workerStart: 5 })];
    start();
    vi.advanceTimersByTime(0);
    const a = vitals("ttfb")[0].attrs ?? {};
    expect(a["everr.browser.web_vital.ttfb.waiting_duration"]).toBe(5);
    expect(a["everr.browser.web_vital.ttfb.cache_duration"]).toBe(5);
  });

  it("offsets by activationStart for prerendered pages, clamped at 0", () => {
    perfEntries.navigation = [nav({ activationStart: 200 })];
    start();
    vi.advanceTimersByTime(0);
    const a = vitals("ttfb")[0].attrs ?? {};
    expect(a["browser.web_vital.value"]).toBe(0);
    expect(a["everr.browser.web_vital.ttfb.waiting_duration"]).toBe(0);
  });

  it("skips an unusable navigation entry (zero or future responseStart)", () => {
    perfEntries.navigation = [nav({ responseStart: 0 })];
    start();
    vi.advanceTimersByTime(0);
    perfEntries.navigation = [nav({ responseStart: 99_999 })];
    start();
    vi.advanceTimersByTime(0);
    expect(vitals("ttfb")).toHaveLength(0);
  });

  it("rates by the 800/1800 thresholds", () => {
    perfEntries.navigation = [nav({ responseStart: 900 })];
    start();
    vi.advanceTimersByTime(0);
    expect(vitals("ttfb")[0].attrs?.["everr.browser.web_vital.rating"]).toBe(
      "needs-improvement",
    );
  });
});

describe("lcp", () => {
  it("reports the latest entry when the page goes hidden, with render phases", () => {
    perfEntries.navigation = [nav({ responseStart: 100 })];
    perfEntries.resource = [
      {
        name: "https://x/hero.png",
        startTime: 30,
        requestStart: 200,
        responseEnd: 400,
      },
    ];
    start();
    document.body.innerHTML = '<img id="hero">';
    fire("largest-contentful-paint", [
      lcpEntry({ startTime: 600 }),
      lcpEntry({
        startTime: 1_000,
        url: "https://x/hero.png",
        element: document.getElementById("hero"),
      }),
    ]);
    hide();
    const [record] = vitals("lcp");
    const a = record.attrs ?? {};
    expect(a["browser.web_vital.value"]).toBe(1_000);
    expect(a["everr.browser.web_vital.rating"]).toBe("good");
    expect(a["everr.browser.web_vital.lcp.target"]).toBe("#hero");
    expect(a["everr.browser.web_vital.lcp.url"]).toBe("https://x/hero.png");
    expect(a["everr.browser.web_vital.lcp.time_to_first_byte"]).toBe(100);
    expect(a["everr.browser.web_vital.lcp.resource_load_delay"]).toBe(100);
    expect(a["everr.browser.web_vital.lcp.resource_load_duration"]).toBe(200);
    expect(a["everr.browser.web_vital.lcp.element_render_delay"]).toBe(600);
  });

  it("finalizes on the first trusted input and stops observing", () => {
    fire("largest-contentful-paint", [lcpEntry({ startTime: 800 })]);
    click(false);
    expect(vitals("lcp")).toHaveLength(0);
    click();
    expect(vitals("lcp")).toHaveLength(1);
    expect(vitals("lcp")[0].attrs?.["browser.web_vital.value"]).toBe(800);
    // The observer disconnected: later entries and hides change nothing.
    expect(observers.has("largest-contentful-paint")).toBe(false);
    hide();
    expect(vitals("lcp")).toHaveLength(1);
  });

  it("names a removed element by its id when the node is already gone", () => {
    fire("largest-contentful-paint", [
      lcpEntry({ startTime: 700, id: "hero", element: null }),
    ]);
    hide();
    expect(vitals("lcp")[0].attrs?.["everr.browser.web_vital.lcp.target"]).toBe(
      "#hero",
    );
  });

  it("without a matching resource entry, the value is all render delay", () => {
    fire("largest-contentful-paint", [lcpEntry({ startTime: 900 })]);
    hide();
    const a = vitals("lcp")[0].attrs ?? {};
    expect(a["everr.browser.web_vital.lcp.time_to_first_byte"]).toBe(120.5);
    expect(a["everr.browser.web_vital.lcp.resource_load_duration"]).toBe(0);
    expect(a["everr.browser.web_vital.lcp.element_render_delay"]).toBe(779.5);
    // Nullish attrs are dropped by the emitter's OTLP mapping downstream.
    expect(a["everr.browser.web_vital.lcp.url"]).toBeUndefined();
  });

  it("ignores entries painted after the page was first hidden", () => {
    hide(500);
    setVisibility("visible");
    fire("largest-contentful-paint", [lcpEntry({ startTime: 1_000 })]);
    hide();
    expect(vitals("lcp")).toHaveLength(0);
  });

  it("does not report when no entry was seen", () => {
    hide();
    expect(vitals("lcp")).toHaveLength(0);
  });

  it("rates by the 2500/4000 thresholds", () => {
    fire("largest-contentful-paint", [lcpEntry({ startTime: 4_500 })]);
    hide(5_000);
    expect(vitals("lcp")[0].attrs?.["everr.browser.web_vital.rating"]).toBe(
      "poor",
    );
  });
});

describe("cls", () => {
  beforeEach(() => {
    perfEntries.paint = [fcp()];
  });

  it("reports the worst session window with the largest shift attributed", () => {
    document.body.innerHTML = "<main><img></main>";
    const img = document.querySelector("img");
    fire("layout-shift", [
      shift({ startTime: 300, value: 0.02 }),
      shift({ startTime: 800, value: 0.05, sources: [{ node: img }] }),
      shift({ startTime: 1_200, value: 0.03 }),
    ]);
    hide();
    const [record] = vitals("cls");
    const a = record.attrs ?? {};
    expect(a["browser.web_vital.value"]).toBeCloseTo(0.1);
    expect(a["everr.browser.web_vital.rating"]).toBe("good");
    expect(a["everr.browser.web_vital.cls.largest_shift_value"]).toBe(0.05);
    expect(a["everr.browser.web_vital.cls.largest_shift_time"]).toBe(800);
    expect(a["everr.browser.web_vital.cls.largest_shift_target"]).toBe(
      "body > main > img",
    );
    expect(a["everr.browser.web_vital.cls.load_state"]).toBe("complete");
  });

  it("starts a new session after a 1s gap and keeps the worst one", () => {
    fire("layout-shift", [
      shift({ startTime: 1_000, value: 0.3 }),
      // 1.5s later: a new session that never catches up.
      shift({ startTime: 2_500, value: 0.1 }),
    ]);
    hide();
    const a = vitals("cls")[0].attrs ?? {};
    expect(a["browser.web_vital.value"]).toBe(0.3);
    expect(a["everr.browser.web_vital.rating"]).toBe("poor");
  });

  it("caps a session at 5s from its first shift", () => {
    // Shifts every 900ms: same session by gap, until the 5s span ends.
    fire(
      "layout-shift",
      Array.from({ length: 8 }, (_, i) =>
        shift({ startTime: 1_000 + i * 900, value: 0.1 }),
      ),
    );
    hide();
    // 6 shifts fit the 5s window (0..4500ms); the 7th starts a new session.
    expect(vitals("cls")[0].attrs?.["browser.web_vital.value"]).toBeCloseTo(
      0.6,
    );
  });

  it("excludes shifts right after user input", () => {
    fire("layout-shift", [
      shift({ value: 0.5, hadRecentInput: true }),
      shift({ startTime: 2_000, value: 0.02 }),
    ]);
    hide();
    expect(vitals("cls")[0].attrs?.["browser.web_vital.value"]).toBe(0.02);
  });

  it("reports zero with no attribution when nothing shifted", () => {
    hide();
    const a = vitals("cls")[0].attrs ?? {};
    expect(a["browser.web_vital.value"]).toBe(0);
    expect(a).not.toHaveProperty(
      "everr.browser.web_vital.cls.largest_shift_value",
    );
  });

  it("does not report without a first contentful paint before first hidden", () => {
    perfEntries.paint = [];
    start();
    fire("layout-shift", [shift()]);
    hide();
    expect(vitals("cls")).toHaveLength(0);
  });

  it("reports at most once per navigation epoch", () => {
    fire("layout-shift", [shift()]);
    hide();
    hide();
    expect(vitals("cls")).toHaveLength(1);
  });
});

describe("bfcache restore", () => {
  it("starts a fresh epoch: ttfb 0, double-rAF lcp, cls re-accumulates", () => {
    vi.advanceTimersByTime(0);
    perfEntries.paint = [fcp()];
    fire("layout-shift", [shift({ value: 0.2 })]);
    hide();
    expect(vitals()).toHaveLength(2); // ttfb + cls (no LCP entry was seen)

    restore(5_000);
    vi.advanceTimersByTime(50); // the double rAF
    const restoredTtfb = vitals("ttfb")[1].attrs ?? {};
    expect(restoredTtfb["browser.web_vital.value"]).toBe(0);
    expect(restoredTtfb["everr.browser.web_vital.navigation_type"]).toBe(
      "back-forward-cache",
    );
    expect(restoredTtfb["browser.web_vital.id"]).not.toBe(
      vitals("ttfb")[0].attrs?.["browser.web_vital.id"],
    );
    // LCP after restore: time from the pageshow to the next paint.
    expect(vitals("lcp")[0].attrs?.["browser.web_vital.value"]).toBe(5_000);

    // The restored epoch accumulates its own CLS and reports it on hidden.
    fire("layout-shift", [shift({ startTime: 12_000, value: 0.07 })]);
    hide(13_000);
    expect(vitals("cls")).toHaveLength(2);
    expect(vitals("cls")[1].attrs?.["browser.web_vital.value"]).toBe(0.07);
  });
});

describe("gating and lifecycle", () => {
  it("observes nothing with an empty vitals list", () => {
    start([]);
    expect(observers.size).toBe(0);
    vi.advanceTimersByTime(0);
    hide();
    expect(emitted).toHaveLength(0);
  });

  it("runs only the configured vitals", () => {
    start(["cls"]);
    expect(observers.has("layout-shift")).toBe(true);
    expect(observers.has("largest-contentful-paint")).toBe(false);
    vi.advanceTimersByTime(0);
    expect(vitals("ttfb")).toHaveLength(0);
  });

  it("degrades to ttfb-only when the observers are unsupported", () => {
    observeThrows = true;
    start();
    fire("layout-shift", [shift()]);
    vi.advanceTimersByTime(0);
    hide();
    expect(vitals("ttfb")).toHaveLength(1);
    expect(vitals("lcp")).toHaveLength(0);
    expect(vitals("cls")).toHaveLength(0);
  });

  it("stops emitting after cleanup", () => {
    perfEntries.paint = [fcp()];
    fire("largest-contentful-paint", [lcpEntry()]);
    fire("layout-shift", [shift()]);
    stop();
    vi.advanceTimersByTime(0);
    hide();
    expect(emitted).toHaveLength(0);
    stop = () => {};
  });
});

// The full-pipeline slice the old web-vitals-mock suite covered: records
// carry the shared envelope, and hidden-time reports ride the keepalive
// exit flush.
describe("through the client pipeline", () => {
  let client: WebSDK | undefined;

  afterEach(async () => {
    await client?.shutdown();
    client = undefined;
    history.replaceState(null, "", "/");
  });

  it("emits browser.web_vital with the envelope and the prefixed attribution", async () => {
    // Restoring real timers restores the original performance object (fake
    // timers patch performance.now), so the timeline stub goes back on after.
    vi.useRealTimers();
    stubTiming();
    let batches: OtlpBatch[];
    [client, batches] = startClient();
    const landing = location.href;
    history.pushState(null, "", "/pricing");
    await new Promise((r) => setTimeout(r)); // the deferred TTFB report
    await client.flush();
    const records = batches
      .flatMap((b) => b.records)
      .filter((r) => r.eventName === "browser.web_vital");
    expect(records).toHaveLength(1);
    const a = attrs(records[0]);
    expect(a["browser.web_vital.name"]).toBe("ttfb");
    expect(a["browser.web_vital.value"]).toBe(120.5);
    expect(a["everr.browser.web_vital.ttfb.request_duration"]).toBe(85.5);
    expect(a["url.path"]).toBe("/pricing");
    // The landing url pins the vital's page on the resource, not the record.
    const resource = Object.fromEntries(
      batches[0].resource.map((kv) => [kv.key, Object.values(kv.value)[0]]),
    );
    expect(resource["everr.landing.url"]).toBe(landing);
    expect(resource["everr.landing.path"]).toBe("/");
    expect(a["session.id"]).toMatch(UNIQUE_ID);
    expect(a["everr.page_view.id"]).toMatch(UNIQUE_ID);
  });

  it("ships hidden-time reports on the keepalive exit flush", async () => {
    // Restoring real timers restores the original performance object (fake
    // timers patch performance.now), so the timeline stub goes back on after.
    vi.useRealTimers();
    stubTiming();
    let batches: OtlpBatch[];
    [client, batches] = startClient();
    perfEntries.paint = [fcp()];
    fire("layout-shift", [shift({ value: 0.3 })]);
    hide();
    await Promise.resolve(); // the emitter's coalesced exit flush microtask
    setVisibility("visible");
    const exitEvents = batches
      .filter((b) => b.keepalive)
      .flatMap((b) => b.records.map((r) => r.eventName));
    expect(exitEvents).toContain("browser.web_vital");
  });
});

describe("first-hidden and load-state edges", () => {
  it("caps first-hidden from the buffered visibility-state entry", () => {
    perfEntries["visibility-state"] = [{ name: "hidden", startTime: 500 }];
    start();
    fire("largest-contentful-paint", [lcpEntry({ startTime: 1_000 })]);
    hide();
    expect(vitals("lcp")).toHaveLength(0);
  });

  it("counts no paints at all when the page starts hidden", () => {
    setVisibility("hidden");
    perfEntries.paint = [fcp()];
    start();
    fire("largest-contentful-paint", [lcpEntry({ startTime: 100 })]);
    fire("layout-shift", [shift()]);
    hide();
    expect(vitals("lcp")).toHaveLength(0);
    expect(vitals("cls")).toHaveLength(0);
  });

  it("reports ttfb from the load event when startup precedes it", () => {
    Object.defineProperty(document, "readyState", {
      value: "loading",
      configurable: true,
    });
    try {
      start(["ttfb"]);
      expect(vitals("ttfb")).toHaveLength(0);
      window.dispatchEvent(new Event("load"));
      vi.advanceTimersByTime(0);
      expect(vitals("ttfb")).toHaveLength(1);
    } finally {
      Object.defineProperty(document, "readyState", {
        value: "complete",
        configurable: true,
      });
    }
  });

  const largestShiftAt = (startTime: number) => {
    setVisibility("visible");
    perfEntries.paint = [fcp()];
    start(["cls"]);
    fire("layout-shift", [shift({ startTime })]);
    hide();
    return vitals("cls")[0].attrs?.["everr.browser.web_vital.cls.load_state"];
  };

  it("stamps the largest shift's document phase", () => {
    expect(largestShiftAt(250)).toBe("loading"); // before domInteractive
    expect(largestShiftAt(350)).toBe("dom-interactive");
    expect(largestShiftAt(450)).toBe("dom-content-loaded");
  });

  it("treats missing dom milestones as still-pending phases", () => {
    perfEntries.navigation = [
      nav({ domContentLoadedEventStart: 0, domComplete: 0 }),
    ];
    expect(largestShiftAt(350)).toBe("dom-interactive");
    perfEntries.navigation = [nav({ domComplete: 0 })];
    expect(largestShiftAt(450)).toBe("dom-content-loaded");
  });

  it("reads the phase as loading while the document still parses", () => {
    Object.defineProperty(document, "readyState", {
      value: "loading",
      configurable: true,
    });
    try {
      expect(largestShiftAt(450)).toBe("loading");
    } finally {
      Object.defineProperty(document, "readyState", {
        value: "complete",
        configurable: true,
      });
    }
  });

  it("falls back to complete (and navigate) without a usable navigation entry", () => {
    perfEntries.navigation = [];
    const a = (() => {
      perfEntries.paint = [fcp()];
      start(["cls"]);
      fire("layout-shift", [shift({ startTime: 100 })]);
      hide();
      return vitals("cls")[0].attrs ?? {};
    })();
    expect(a["everr.browser.web_vital.cls.load_state"]).toBe("complete");
    expect(a["everr.browser.web_vital.navigation_type"]).toBe("navigate");
  });

  it("uses the resource's startTime when TAO hides requestStart", () => {
    perfEntries.navigation = [nav({ responseStart: 100 })];
    perfEntries.resource = [
      {
        name: "https://x/hero.png",
        startTime: 200,
        requestStart: 0,
        responseEnd: 400,
      },
    ];
    start(["lcp"]);
    fire("largest-contentful-paint", [
      lcpEntry({ startTime: 1_000, url: "https://x/hero.png" }),
    ]);
    hide();
    const a = vitals("lcp")[0].attrs ?? {};
    expect(a["everr.browser.web_vital.lcp.resource_load_delay"]).toBe(100);
    expect(a["everr.browser.web_vital.lcp.resource_load_duration"]).toBe(200);
  });
});

describe("lifecycle edges", () => {
  it("ignores visibility changes that stay visible", () => {
    perfEntries.paint = [fcp()];
    fire("largest-contentful-paint", [lcpEntry()]);
    fire("layout-shift", [shift()]);
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    expect(vitals()).toHaveLength(0);
  });

  it("ignores a non-persisted pageshow", () => {
    vi.advanceTimersByTime(0);
    expect(vitals("ttfb")).toHaveLength(1);
    window.dispatchEvent(new Event("pageshow"));
    vi.advanceTimersByTime(50);
    expect(vitals()).toHaveLength(1);
  });

  it("restore with only ttfb configured re-reports just ttfb", () => {
    start(["ttfb"]);
    vi.advanceTimersByTime(0);
    restore();
    vi.advanceTimersByTime(50);
    expect(vitals("ttfb")).toHaveLength(2);
    expect(vitals("lcp")).toHaveLength(0);
  });

  it("restore without a usable navigation entry skips the ttfb re-report", () => {
    perfEntries.navigation = [nav({ responseStart: 0 })];
    start(["ttfb", "lcp"]);
    restore();
    vi.advanceTimersByTime(50);
    expect(vitals("ttfb")).toHaveLength(0);
    expect(vitals("lcp")).toHaveLength(1);
  });

  it("restore for lcp and cls only never re-reports ttfb", () => {
    start(["lcp", "cls"]);
    restore();
    vi.advanceTimersByTime(50);
    expect(vitals("ttfb")).toHaveLength(0);
    expect(vitals("lcp")).toHaveLength(1);
  });

  it("a stop between restore and the next paint suppresses the lcp", () => {
    start(["lcp"]);
    restore();
    stop();
    vi.advanceTimersByTime(50);
    expect(vitals("lcp")).toHaveLength(0);
    stop = () => {};
  });
});

describe("threshold and window boundaries", () => {
  it("rates a value exactly on a threshold at the better band", () => {
    perfEntries.navigation = [nav({ responseStart: 800 })];
    start(["ttfb"]);
    vi.advanceTimersByTime(0);
    expect(vitals("ttfb")[0].attrs?.["everr.browser.web_vital.rating"]).toBe(
      "good",
    );
    perfEntries.navigation = [nav({ responseStart: 1_800 })];
    start(["ttfb"]);
    vi.advanceTimersByTime(0);
    expect(vitals("ttfb")[0].attrs?.["everr.browser.web_vital.rating"]).toBe(
      "needs-improvement",
    );
  });

  it("rejects a navigation entry whose responseStart is exactly now", () => {
    perfEntries.navigation = [nav({ responseStart: 10_000 })]; // == now
    start(["ttfb"]);
    vi.advanceTimersByTime(0);
    expect(vitals("ttfb")).toHaveLength(0);
  });

  it("splits CLS sessions at exactly a 1s gap, merges at 999ms", () => {
    perfEntries.paint = [fcp()];
    start(["cls"]);
    fire("layout-shift", [
      shift({ startTime: 1_000, value: 0.1 }),
      shift({ startTime: 2_000, value: 0.1 }), // gap exactly 1s: new session
    ]);
    hide();
    expect(vitals("cls")[0].attrs?.["browser.web_vital.value"]).toBeCloseTo(
      0.1,
    );

    setVisibility("visible");
    start(["cls"]);
    fire("layout-shift", [
      shift({ startTime: 1_000, value: 0.1 }),
      shift({ startTime: 1_999, value: 0.1 }), // 999ms gap: same session
    ]);
    hide();
    expect(vitals("cls")[0].attrs?.["browser.web_vital.value"]).toBeCloseTo(
      0.2,
    );
  });

  it("ends a CLS session at exactly the 5s span", () => {
    perfEntries.paint = [fcp()];
    start(["cls"]);
    // Gaps of 900ms keep the chain alive; the shift at exactly first+5000
    // must start a new session.
    fire("layout-shift", [
      ...Array.from({ length: 6 }, (_, i) =>
        shift({ startTime: 1_000 + i * 900, value: 0.1 }),
      ), // 1000..5500 in 900ms steps: one session, 4500ms span
    ]);
    fire("layout-shift", [shift({ startTime: 6_000, value: 0.1 })]); // span exactly 5000
    hide();
    expect(vitals("cls")[0].attrs?.["browser.web_vital.value"]).toBeCloseTo(
      0.6,
    );
  });

  it("keeps the first shift as largest on an exact value tie", () => {
    perfEntries.paint = [fcp()];
    start(["cls"]);
    fire("layout-shift", [
      shift({ startTime: 1_000, value: 0.1 }),
      shift({ startTime: 1_500, value: 0.1 }),
    ]);
    hide();
    const a = vitals("cls")[0].attrs ?? {};
    expect(a["everr.browser.web_vital.cls.largest_shift_time"]).toBe(1_000);
  });

  it("keeps the first session as worst on an exact session-value tie", () => {
    perfEntries.paint = [fcp()];
    start(["cls"]);
    fire("layout-shift", [
      shift({ startTime: 1_000, value: 0.1 }),
      shift({ startTime: 3_000, value: 0.1 }), // separate session, equal value
    ]);
    hide();
    const a = vitals("cls")[0].attrs ?? {};
    expect(a["everr.browser.web_vital.cls.largest_shift_time"]).toBe(1_000);
  });

  it("maps a shift exactly on a document milestone to the later phase", () => {
    const largestShiftAt = (startTime: number) => {
      setVisibility("visible");
      perfEntries.paint = [fcp()];
      start(["cls"]);
      fire("layout-shift", [shift({ startTime })]);
      hide();
      return vitals("cls")[0].attrs?.["everr.browser.web_vital.cls.load_state"];
    };
    expect(largestShiftAt(300)).toBe("dom-interactive"); // == domInteractive
    expect(largestShiftAt(400)).toBe("dom-content-loaded"); // == dclStart
    expect(largestShiftAt(500)).toBe("complete"); // == domComplete
  });
});
