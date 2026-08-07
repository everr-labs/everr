import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Emit } from "../../emitter.js";
import { startInp } from "./inp.js";
import { startWebVitals } from "./webvitals.js";

// Property tests for the ported web-vitals math: the INP p98 candidate
// selection and phase breakdown, and the CLS session windowing. The
// reference implementations below restate the published specs (the
// web.dev definitions), so a divergence flags drift in the port, not in
// the test.

let emitted: Array<{ name: string; attrs?: Record<string, unknown> }>;
const emit: Emit = (name, attrs) => {
  emitted.push({ name, attrs });
};
const vitals = () => emitted.filter((e) => e.name === "browser.web_vital");

let observers: Map<string, (list: { getEntries: () => unknown[] }) => void>;

function stubTiming() {
  observers = new Map();
  class FakePerformanceEventTiming {
    get interactionId() {
      return 0;
    }
  }
  class PO {
    cb: (list: { getEntries: () => unknown[] }) => void;
    types: string[] = [];
    constructor(cb: (list: { getEntries: () => unknown[] }) => void) {
      this.cb = cb;
    }
    observe(opts: { type: string }) {
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
  vi.stubGlobal("PerformanceEventTiming", FakePerformanceEventTiming);
  vi.stubGlobal("PerformanceObserver", PO);
  vi.stubGlobal("performance", {
    now: () => 1_000_000,
    getEntriesByType: (type: string) =>
      type === "paint"
        ? [{ name: "first-contentful-paint", startTime: 50 }]
        : [],
  });
}

function fire(type: string, entries: unknown[]) {
  observers.get(type)?.({ getEntries: () => entries });
}

function setVisibility(value: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    value,
    configurable: true,
  });
}

function hide(at = 900_000) {
  setVisibility("hidden");
  const event = new Event("visibilitychange", { bubbles: true });
  Object.defineProperty(event, "timeStamp", { value: at });
  document.dispatchEvent(event);
}

beforeEach(() => {
  vi.useFakeTimers();
  emitted = [];
  stubTiming();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("INP", () => {
  // One entry per unique interaction id: latency is then exactly the entry
  // duration, so the reference below is the p98 spec, not the stream logic.
  const interactions = fc
    .uniqueArray(fc.integer({ min: 1, max: 80 }), {
      minLength: 1,
      maxLength: 60,
    })
    .chain((ids) =>
      fc.tuple(
        fc.constant(ids),
        fc.array(fc.integer({ min: 0, max: 1_000 }), {
          minLength: ids.length,
          maxLength: ids.length,
        }),
      ),
    );

  it("reports the estimated-p98 longest interaction", () => {
    fc.assert(
      fc.property(interactions, ([ids, durations]) => {
        emitted = [];
        setVisibility("visible");
        const stop = startInp(emit, true, false);
        fire(
          "event",
          ids.map((id, i) => ({
            entryType: "event",
            name: "click",
            interactionId: id * 7,
            target: null,
            startTime: i * 10_000,
            duration: durations[i],
            processingStart: i * 10_000 + 1,
            processingEnd: i * 10_000 + 2,
          })),
        );
        vi.advanceTimersByTime(0);
        hide();
        stop();

        // Reference: interaction count estimated from the id spread, the
        // candidate list capped at ten, index = min(count / 50, list end).
        const count = Math.max(...ids) - Math.min(...ids) + 1;
        const sorted = [...durations].sort((a, b) => b - a);
        const index = Math.min(
          Math.min(10, ids.length) - 1,
          Math.floor(count / 50),
        );
        expect(vitals()).toHaveLength(1);
        expect(vitals()[0].attrs?.["browser.web_vital.value"]).toBe(
          sorted[index],
        );
      }),
      { numRuns: 50 },
    );
  });

  it("splits any slow interaction into non-negative phases that sum to next paint", () => {
    const timing = fc
      .tuple(
        fc.integer({ min: 0, max: 100_000 }), // startTime
        fc.integer({ min: 200, max: 2_000 }), // duration (slow)
        fc.integer({ min: 0, max: 2_500 }), // processing start offset
        fc.integer({ min: 0, max: 3_000 }), // processing length
      )
      .map(([startTime, duration, psOffset, length]) => ({
        startTime,
        duration,
        processingStart: startTime + psOffset,
        processingEnd: startTime + psOffset + length,
      }));

    fc.assert(
      fc.property(timing, (entry) => {
        emitted = [];
        setVisibility("visible");
        const stop = startInp(emit, false, true);
        fire("event", [
          {
            entryType: "event",
            name: "click",
            interactionId: 7,
            target: null,
            ...entry,
          },
        ]);
        vi.advanceTimersByTime(1_000);
        stop();

        const a = emitted[0]?.attrs ?? {};
        const inputDelay = a["everr.browser.interaction.input_delay"] as number;
        const processing = a[
          "everr.browser.interaction.processing_duration"
        ] as number;
        const presentation = a[
          "everr.browser.interaction.presentation_delay"
        ] as number;
        expect(inputDelay).toBeGreaterThanOrEqual(0);
        expect(processing).toBeGreaterThanOrEqual(0);
        expect(presentation).toBeGreaterThanOrEqual(0);
        // The phases tile the interaction-to-next-paint window exactly.
        const nextPaint = Math.max(
          entry.startTime + entry.duration,
          entry.processingStart,
        );
        expect(inputDelay + processing + presentation).toBe(
          nextPaint - entry.startTime,
        );
      }),
      { numRuns: 50 },
    );
  });
});

describe("CLS", () => {
  const shifts = fc.array(
    fc.record({
      gap: fc.integer({ min: 0, max: 3_000 }),
      value: fc.integer({ min: 1, max: 500 }),
      hadRecentInput: fc.boolean(),
    }),
    { maxLength: 40 },
  );

  it("reports the worst session window per the 1s-gap/5s-span rule", () => {
    fc.assert(
      fc.property(shifts, (raw) => {
        emitted = [];
        setVisibility("visible");
        const stop = startWebVitals(emit, ["cls"]);
        let startTime = 100;
        const entries = raw.map((s) => {
          startTime += s.gap;
          return {
            startTime,
            value: s.value / 1_000,
            hadRecentInput: s.hadRecentInput,
            sources: [],
          };
        });
        fire("layout-shift", entries);
        hide();
        stop();

        // Reference fold of the spec: sessions split on a 1s entry gap or a
        // 5s total span, worst session wins, input-adjacent shifts excluded.
        let worst = 0;
        let session = { value: 0, first: 0, last: 0 };
        for (const e of entries) {
          if (e.hadRecentInput) continue;
          if (
            session.value &&
            e.startTime - session.last < 1_000 &&
            e.startTime - session.first < 5_000
          ) {
            session.value += e.value;
            session.last = e.startTime;
          } else {
            session = { value: e.value, first: e.startTime, last: e.startTime };
          }
          worst = Math.max(worst, session.value);
        }
        expect(vitals()).toHaveLength(1);
        expect(vitals()[0].attrs?.["browser.web_vital.value"]).toBeCloseTo(
          worst,
          9,
        );
      }),
      { numRuns: 50 },
    );
  });
});
