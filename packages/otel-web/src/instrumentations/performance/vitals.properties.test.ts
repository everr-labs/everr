import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Emit } from "../../emitter.js";
import { createTracer } from "../../tracer.js";
import { startInp } from "./inp.js";
import { startWebVitals } from "./webvitals.js";

// Property tests for the calculations from web-vitals in this package. They
// examine the selection of the p98 candidate for the INP, the durations of its
// phases, and the session windows of the CLS. The reference code below gives the
// published specifications, which are the definitions on web.dev. Thus a
// difference shows an error in this package and not in the test.

let emitted: Array<{ name: string; attrs?: Record<string, unknown> }>;
const emit: Emit = (name, attrs) => {
  emitted.push({ name, attrs });
};
const vitals = () => emitted.filter((e) => e.name === "browser.web_vital");

// A slow interaction is a span. This is the true tracer that sends its spans to
// a test function.
let spans: Array<{ attrs: Record<string, unknown> }>;
const tracer = createTracer((_traceId, _spanId, _name, _start, _end, attrs) => {
  spans.push({ attrs });
});

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
  // There is one entry for each interaction id. Thus the latency is exactly the
  // duration of the entry. Therefore the reference code below gives the p98
  // specification, and it does not repeat the code that processes the entries.
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
        const stop = startInp(emit, tracer, true, false);
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

        // The reference code. It calculates the number of the interactions
        // from the range of the ids. The list of the candidates has a maximum of
        // ten interactions. The index is min(count / 50, the last index of the
        // list).
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
        spans = [];
        setVisibility("visible");
        const stop = startInp(emit, tracer, false, true);
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

        const a = spans[0]?.attrs ?? {};
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
        // The phases fill the full window from the interaction to the next
        // paint.
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

        // The reference code for the specification. A new session starts after
        // a gap of 1 s between the entries, or after a total length of 5 s. The
        // session with the largest value wins. The code does not count a shift
        // near an input.
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
