import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CLSMetricWithAttribution,
  MetricWithAttribution,
  TTFBMetricWithAttribution,
} from "web-vitals/attribution";
import { init } from "./client.js";
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

type OtlpRecord = {
  eventName: string;
  attributes: Array<{ key: string; value: Record<string, unknown> }>;
};

let client: EverrClient | undefined;
let batches: Array<{ keepalive: boolean; records: OtlpRecord[] }>;

function start(options?: {
  disable?: true | CaptureSignal[];
  routePattern?: () => string | null | undefined;
}): void {
  batches = [];
  callbacks.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      batches.push({
        keepalive: Boolean(init?.keepalive),
        records: JSON.parse(String(init?.body)).resourceLogs[0].scopeLogs[0]
          .logRecords,
      });
      return Promise.resolve(new Response(null, { status: 200 }));
    }),
  );
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

function attrs(record: OtlpRecord): Record<string, unknown> {
  return Object.fromEntries(
    record.attributes.map(({ key, value }) => [key, Object.values(value)[0]]),
  );
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

  it("stamps the route pattern sampled at report time and survives a throwing host callback", async () => {
    let pattern: string | undefined;
    start({ routePattern: () => pattern });
    pattern = "/blog/$slug";
    report(ttfb());
    expect(attrs((await vitals())[0])["everr.route.pattern"]).toBe(
      "/blog/$slug",
    );

    await client?.shutdown();
    start({
      routePattern: () => {
        throw new Error("host bug");
      },
    });
    report(ttfb());
    const [record] = await vitals();
    expect(attrs(record)).not.toHaveProperty("everr.route.pattern");
  });

  it("rides the keepalive exit flush when reported at page hide", async () => {
    start();
    // Simulate web-vitals' capture-phase hidden reporting: the record must be
    // queued in time for the exit flush triggered by the same transition.
    addEventListener("pagehide", () => report(cls()), true);
    dispatchEvent(new Event("pagehide"));
    const exit = batches.find((b) => b.keepalive);
    expect(exit?.records.map((r) => r.eventName)).toContain(
      "browser.web_vital",
    );
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
