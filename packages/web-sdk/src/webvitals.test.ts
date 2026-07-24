import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CLSMetricWithAttribution,
  MetricWithAttribution,
  TTFBMetricWithAttribution,
} from "web-vitals/attribution";
import { init } from "./client.js";
import {
  attrs,
  type OtlpBatch,
  type OtlpRecord,
  stubOtlpFetch,
} from "./test-kit.js";
import type { CaptureSignal, EverrClient } from "./types.js";

// The web-vitals library only reports from real PerformanceObserver entries,
// which jsdom does not produce: the mock captures the registered callbacks so
// tests drive metric reports by hand through the real init pipeline.

const callbacks: Array<(metric: MetricWithAttribution) => void> = [];
vi.mock("web-vitals/attribution", () => {
  const on = (cb: (metric: MetricWithAttribution) => void) => {
    callbacks.push(cb);
  };
  return { onCLS: on, onFCP: on, onINP: on, onLCP: on, onTTFB: on };
});

const report = (metric: Partial<MetricWithAttribution>) => {
  for (const cb of callbacks) cb(metric as MetricWithAttribution);
};

const ttfb = (over?: Partial<TTFBMetricWithAttribution>) =>
  ({
    name: "TTFB",
    value: 120.5,
    delta: 120.5,
    id: "v5-ttfb-1",
    rating: "good",
    navigationType: "navigate",
    entries: [],
    attribution: {
      waitingDuration: 10,
      cacheDuration: 0,
      dnsDuration: 5,
      connectionDuration: 20,
      requestDuration: 85.5,
    },
    ...over,
  }) as TTFBMetricWithAttribution;

const cls = (over?: Partial<CLSMetricWithAttribution>) =>
  ({
    name: "CLS",
    value: 0.05,
    delta: 0.05,
    id: "v5-cls-1",
    rating: "good",
    navigationType: "navigate",
    entries: [],
    attribution: {
      largestShiftTarget: "main>img",
      largestShiftValue: 0.05,
      largestShiftTime: 300,
      loadState: "complete",
    },
    ...over,
  }) as CLSMetricWithAttribution;

let client: EverrClient | undefined;
let batches: OtlpBatch[];

function start(options?: {
  disable?: true | CaptureSignal[];
  routePattern?: () => string | null | undefined;
}): void {
  callbacks.length = 0;
  batches = stubOtlpFetch();
  client = init({
    mode: "cookieless",
    serviceName: "everr-docs-test",
    dev: true,
    ...options,
  });
}

async function vitals(): Promise<OtlpRecord[]> {
  await client?.flush();
  return batches
    .flatMap((b) => b.records)
    .filter((r) => r.eventName === "browser.web_vital");
}

afterEach(async () => {
  await client?.shutdown();
  client = undefined;
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

describe("web vitals", () => {
  it("registers the five metric callbacks", () => {
    start();
    expect(callbacks).toHaveLength(5);
  });

  it("emits browser.web_vital with semconv names, the envelope, and attribution", async () => {
    start();
    report(ttfb());
    const [record] = await vitals();
    const a = attrs(record);
    expect(a["browser.web_vital.name"]).toBe("ttfb");
    expect(a["browser.web_vital.value"]).toBe(120.5);
    expect(a["browser.web_vital.delta"]).toBe(120.5);
    expect(a["browser.web_vital.id"]).toBe("v5-ttfb-1");
    expect(a["browser.web_vital.rating"]).toBe("good");
    expect(a["browser.web_vital.navigation_type"]).toBe("navigate");
    expect(a["browser.web_vital.ttfb.request_duration"]).toBe(85.5);
    // Absent-in-this-browser attribution stays absent, not empty.
    expect(a).not.toHaveProperty("browser.web_vital.navigation_id");
    // The shared analytics envelope makes vitals join the session.
    expect(a["session.id"]).toMatch(/[0-9a-f-]{36}/);
    expect(a["everr.page_view.id"]).toMatch(/[0-9a-f-]{36}/);
  });

  it("dedupes repeated reports by metric id, latest value not double-counted", async () => {
    start();
    report(cls());
    report(cls({ value: 0.4, delta: 0.35, rating: "poor" }));
    const all = await vitals();
    expect(all).toHaveLength(1);
    // A fresh id (e.g. after a bfcache restore) still reports.
    report(cls({ id: "v5-cls-2", navigationType: "back-forward-cache" }));
    expect(await vitals()).toHaveLength(2);
  });

  it("pins the landing url while the envelope follows SPA navigation", async () => {
    start();
    const landing = location.href;
    history.pushState(null, "", "/pricing");
    report(cls());
    const [record] = await vitals();
    const a = attrs(record);
    expect(a["everr.landing.url"]).toBe(landing);
    expect(a["everr.landing.path"]).toBe("/");
    expect(a["url.path"]).toBe("/pricing");
  });

  it("reaches the keepalive exit batch even when reported after the exit flush", async () => {
    start();
    // Worst-case listener ordering: the vital reports from a bubble-phase
    // pagehide listener registered after the client's own exit-flush
    // listeners, while the page is already hidden. The emitter's coalesced
    // hidden-state flush must still ship it on the keepalive path.
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    const late = () => report(cls());
    addEventListener("pagehide", late);
    dispatchEvent(new Event("pagehide"));
    removeEventListener("pagehide", late);
    await Promise.resolve();
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    const exitEvents = batches
      .filter((b) => b.keepalive)
      .flatMap((b) => b.records.map((r) => r.eventName));
    expect(exitEvents).toContain("browser.web_vital");
  });

  it('registers nothing with disable: ["webVitals"]', () => {
    start({ disable: ["webVitals"] });
    expect(callbacks).toHaveLength(0);
  });

  it("stops emitting after shutdown even though web-vitals cannot unsubscribe", async () => {
    start();
    await client?.shutdown();
    report(ttfb());
    expect(await vitals()).toHaveLength(0);
  });
});
