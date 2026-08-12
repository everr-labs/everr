import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Emit } from "../../pipeline/emitter.js";
import { createTracer } from "../../pipeline/tracer.js";
import { startInp } from "./inp.js";

// The jsdom environment has no Event Timing and no PerformanceObserver
// entries. Thus these tests replace PerformanceEventTiming, which the code uses
// to find the available functions, and PerformanceObserver, which keeps the
// function for each entry type. Then the tests send the entries themselves. The
// tests also replace the timers, because the code processes an entry in the idle
// period, which uses setTimeout here, and a slow record waits on a timer of
// 1 s.

let emitted: Array<{ name: string; attrs?: Record<string, unknown> }>;
let spans: Array<{
  name: string;
  duration: number;
  attrs: Record<string, unknown>;
}>;
let stop: () => void;

const emit: Emit = (name, attrs) => {
  emitted.push({ name, attrs });
};

// The true tracer that sends its spans to a test function. A slow interaction
// is a span. Its duration is the latency, and the latency is not an attribute.
const tracer = createTracer((_traceId, _spanId, name, start, end, attrs) => {
  spans.push({ name, duration: end - start, attrs });
});

const slow = () => spans.filter((s) => s.name === "slow_interaction");
const vitals = () => emitted.filter((e) => e.name === "browser.web_vital");

type FakeEntry = {
  entryType: string;
  name: string;
  duration: number;
  startTime: number;
  processingStart: number;
  processingEnd: number;
  interactionId: number;
  target: Node | null;
};

function entry(over: Partial<FakeEntry>): FakeEntry {
  const startTime = over.startTime ?? 1000;
  const duration = over.duration ?? 300;
  return {
    entryType: "event",
    name: "click",
    interactionId: 7,
    target: null,
    startTime,
    duration,
    processingStart: over.processingStart ?? startTime + 20,
    processingEnd: over.processingEnd ?? startTime + 120,
    ...over,
  };
}

type FakeLoaf = {
  startTime: number;
  duration: number;
  styleAndLayoutStart: number;
  scripts: Array<{
    startTime: number;
    duration: number;
    forcedStyleAndLayoutDuration: number;
    sourceURL: string;
    sourceFunctionName: string;
    invokerType: string;
  }>;
};

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
    static supportedEntryTypes = [
      "event",
      "first-input",
      "long-animation-frame",
    ];
  }
  vi.stubGlobal("PerformanceEventTiming", FakePerformanceEventTiming);
  vi.stubGlobal("PerformanceObserver", PO);
}

function fire(type: string, entries: unknown[]) {
  observers.get(type)?.({ getEntries: () => entries });
}

/** Sends the event entries, then does the processing of the idle period. */
function feed(entries: Partial<FakeEntry>[]) {
  fire("event", entries.map(entry));
  vi.advanceTimersByTime(0);
}

/** Completes the slow interactions that wait. */
const settle = () => vi.advanceTimersByTime(1_000);

function hide() {
  Object.defineProperty(document, "visibilityState", {
    value: "hidden",
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
}

beforeEach(() => {
  vi.useFakeTimers();
  emitted = [];
  spans = [];
  document.body.innerHTML = "";
  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    configurable: true,
  });
  stubTiming();
  stop = startInp(emit, tracer, true, true);
});

afterEach(() => {
  stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("slow interactions", () => {
  it("groups entries by interactionId into one record with the max duration", () => {
    document.body.innerHTML = '<button id="b">Go</button>';
    const target = document.getElementById("b");
    feed([
      { name: "pointerdown", duration: 220, interactionId: 7, target },
      { name: "pointerup", duration: 230, interactionId: 7, target },
      { name: "click", duration: 240, interactionId: 7, target },
    ]);
    settle();

    expect(emitted).toHaveLength(0);
    expect(slow()).toHaveLength(1);
    expect(slow()[0].duration).toBe(240);
    const a = slow()[0].attrs;
    expect(a["everr.browser.interaction.id"]).toBe(7);
    expect(a["everr.browser.interaction.name"]).toBe("click");
    expect(a["everr.browser.interaction.type"]).toBe("pointer");
    expect(a["everr.element.tag"]).toBe("button");
    expect(a["everr.element.selector"]).toBe("#b");
  });

  it("carries the phase breakdown from the entry timings", () => {
    feed([
      {
        duration: 400,
        startTime: 1000,
        processingStart: 1100,
        processingEnd: 1250,
      },
    ]);
    settle();
    const a = slow()[0].attrs;
    expect(a["everr.browser.interaction.input_delay"]).toBe(100);
    expect(a["everr.browser.interaction.processing_duration"]).toBe(150);
    // The presentation time is nextPaint (1000 + 400) minus processingEnd
    // (1250).
    expect(a["everr.browser.interaction.presentation_delay"]).toBe(150);
  });

  it("emits at most once per interactionId", () => {
    feed([{ duration: 250, interactionId: 7 }]);
    settle();
    feed([{ duration: 300, interactionId: 7 }]);
    settle();
    expect(slow()).toHaveLength(1);
  });

  it("ignores interactions under 200ms", () => {
    feed([{ duration: 120 }]);
    settle();
    expect(slow()).toHaveLength(0);
  });

  it("keyboard interactions are typed keyboard", () => {
    feed([{ name: "keydown", duration: 510, interactionId: 9 }]);
    settle();
    expect(slow()[0].attrs?.["everr.browser.interaction.type"]).toBe(
      "keyboard",
    );
  });

  it("keeps the record but drops element identity for guarded elements", () => {
    document.body.innerHTML =
      '<div class="everr-no-capture"><button id="x">Hidden</button></div>';
    feed([{ duration: 320, target: document.getElementById("x") }]);
    settle();
    expect(slow()).toHaveLength(1);
    expect(slow()[0].duration).toBe(320);
    const a = slow()[0].attrs;
    expect(a).not.toHaveProperty("everr.element.tag");
    expect(a).not.toHaveProperty("everr.element.selector");
  });

  it("attributes the longest intersecting LoAF script", () => {
    const loaf: FakeLoaf = {
      startTime: 1010,
      duration: 300,
      styleAndLayoutStart: 1310,
      scripts: [
        {
          startTime: 1020,
          duration: 280,
          forcedStyleAndLayoutDuration: 0,
          sourceURL: "https://app.example/bundle.js",
          sourceFunctionName: "renderList",
          invokerType: "event-listener",
        },
      ],
    };
    fire("long-animation-frame", [loaf]);
    feed([
      {
        duration: 400,
        startTime: 1000,
        processingStart: 1010,
        processingEnd: 1350,
      },
    ]);
    settle();
    const a = slow()[0].attrs;
    expect(a["everr.browser.interaction.script.source_url"]).toBe(
      "https://app.example/bundle.js",
    );
    expect(a["everr.browser.interaction.script.function_name"]).toBe(
      "renderList",
    );
    expect(a["everr.browser.interaction.script.invoker_type"]).toBe(
      "event-listener",
    );
    expect(a["everr.browser.interaction.script.duration"]).toBe(280);
    // The durations of the categories in the frames that are in the
    // interaction. There are 280 ms of script. The LoAF data gives no category
    // for the remainder of the interaction of 400 ms.
    expect(a["everr.browser.interaction.total_script_duration"]).toBe(280);
    expect(a["everr.browser.interaction.total_style_and_layout_duration"]).toBe(
      0,
    );
    expect(a["everr.browser.interaction.total_paint_duration"]).toBe(0);
    expect(a["everr.browser.interaction.total_unattributed_duration"]).toBe(
      120,
    );
  });

  it("takes the target from any entry that carries one (often only pointerdown does)", () => {
    document.body.innerHTML = '<button id="b">Go</button>';
    const target = document.getElementById("b");
    feed([
      { name: "pointerdown", duration: 220, interactionId: 7, target },
      { name: "click", duration: 300, interactionId: 7, target: null },
    ]);
    settle();
    expect(slow()[0].duration).toBe(300);
    expect(slow()[0].attrs["everr.element.selector"]).toBe("#b");
  });

  it("keeps the element payload when the target is removed before settling", () => {
    document.body.innerHTML = '<dialog><button id="close">X</button></dialog>';
    const target = document.getElementById("close");
    feed([{ duration: 260, target }]);
    // The user closes the dialog, and thus the button goes out of the DOM
    // before the wait ends. The entry.target value is now null. But the code
    // captured the data immediately, at the time of the processing.
    target?.remove();
    settle();
    const a = slow()[0].attrs;
    expect(a["everr.element.tag"]).toBe("button");
    expect(a["everr.element.selector"]).toBe("#close");
  });

  it("settles on page hide without waiting for the timer", () => {
    feed([{ duration: 250 }]);
    hide();
    expect(slow()).toHaveLength(1);
  });
});

describe("INP vital", () => {
  it("reports the worst interaction on hidden with the shared attribution vocabulary", () => {
    document.body.innerHTML = '<button id="b">Go</button>';
    feed([
      { duration: 250, interactionId: 7, target: document.getElementById("b") },
      { duration: 620, interactionId: 14 },
      { duration: 90, interactionId: 21 },
    ]);
    settle();
    hide();

    expect(vitals()).toHaveLength(1);
    const a = vitals()[0].attrs ?? {};
    expect(a["browser.web_vital.name"]).toBe("inp");
    expect(a["browser.web_vital.value"]).toBe(620);
    expect(a["browser.web_vital.delta"]).toBe(620);
    expect(a["browser.web_vital.id"]).toMatch(/^\d+-\d{13}$/);
    expect(a["everr.browser.web_vital.rating"]).toBe("poor");
    // The key that connects this record to the slow_interaction record, and
    // the same attribution keys as that record.
    expect(a["everr.browser.interaction.id"]).toBe(14);
    expect(a["everr.browser.interaction.input_delay"]).toBe(20);
    expect(a["everr.browser.interaction.type"]).toBe("pointer");
  });

  it("carries the element payload of its candidate interaction", () => {
    document.body.innerHTML = '<button id="b">Go</button>';
    feed([
      {
        name: "pointerdown",
        duration: 320,
        interactionId: 7,
        target: document.getElementById("b"),
      },
    ]);
    settle();
    hide();
    const a = vitals()[0].attrs ?? {};
    expect(a["everr.element.selector"]).toBe("#b");
    expect(a["everr.element.tag"]).toBe("button");
  });

  it("reports sub-200ms interactions too (no vital-side threshold)", () => {
    feed([{ duration: 120, interactionId: 7 }]);
    settle();
    hide();
    expect(slow()).toHaveLength(0);
    expect(vitals()).toHaveLength(1);
    expect(vitals()[0].attrs?.["browser.web_vital.value"]).toBe(120);
    expect(vitals()[0].attrs?.["everr.browser.web_vital.rating"]).toBe("good");
  });

  it("reports at most once per navigation epoch", () => {
    feed([{ duration: 300 }]);
    settle();
    hide();
    hide();
    expect(vitals()).toHaveLength(1);
  });

  it("does not report when there were no interactions", () => {
    hide();
    expect(vitals()).toHaveLength(0);
  });

  it("estimates p98 beyond 50 interactions instead of taking the worst", () => {
    // There are 60 interactions. The ids increase by 7, which is the increment
    // of Chrome, and the code uses them to calculate interactionCount. The index
    // is floor(60/50), which is 1. Thus the result is the second longest
    // interaction.
    feed(
      Array.from({ length: 60 }, (_, i) => ({
        interactionId: 7 * (i + 1),
        duration: 600 - i,
        startTime: 1000 + i * 500,
      })),
    );
    settle();
    hide();
    expect(vitals()[0].attrs?.["browser.web_vital.value"]).toBe(599);
  });

  it("reports a sub-threshold first interaction via its first-input entry", () => {
    feed([{ entryType: "first-input", interactionId: 0, duration: 24 }]);
    settle();
    hide();
    expect(slow()).toHaveLength(0);
    expect(vitals()[0].attrs?.["browser.web_vital.value"]).toBe(24);
  });

  it("starts a fresh epoch on bfcache restore: new id, candidates reset", () => {
    feed([{ interactionId: 7, duration: 620 }]);
    settle();
    hide();
    const first = vitals()[0].attrs ?? {};
    expect(first["browser.web_vital.value"]).toBe(620);

    // The browser gives the page from the bfcache. The page becomes visible
    // again, and the new navigation measures its own INP from the start.
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    const pageshow = new Event("pageshow");
    Object.defineProperty(pageshow, "persisted", { value: true });
    window.dispatchEvent(pageshow);

    feed([{ interactionId: 14, duration: 210 }]);
    settle();
    hide();

    expect(vitals()).toHaveLength(2);
    const second = vitals()[1].attrs ?? {};
    // The previous candidate of 620 ms is not in the list. The new navigation
    // period sends its own value.
    expect(second["browser.web_vital.value"]).toBe(210);
    expect(second["browser.web_vital.id"]).not.toBe(
      first["browser.web_vital.id"],
    );
    expect(second["everr.browser.web_vital.navigation_type"]).toBe(
      "back-forward-cache",
    );
  });
});

describe("output gating", () => {
  it("suppresses slow records when slow is off, still reports the vital", () => {
    stop();
    emitted = [];
    stop = startInp(emit, tracer, true, false);
    feed([{ duration: 300 }]);
    settle();
    expect(slow()).toHaveLength(0);
    hide();
    expect(vitals()).toHaveLength(1);
  });

  it("suppresses the vital when vital is off, still emits slow records", () => {
    stop();
    emitted = [];
    stop = startInp(emit, tracer, false, true);
    feed([{ duration: 300 }]);
    settle();
    expect(slow()).toHaveLength(1);
    hide();
    expect(vitals()).toHaveLength(0);
  });
});

describe("lifecycle", () => {
  it("is a no-op without Event Timing support", () => {
    stop();
    vi.unstubAllGlobals();
    const noop = startInp(emit, tracer, true, true);
    noop();
    expect(emitted).toHaveLength(0);
    expect(spans).toHaveLength(0);
    stop = () => {};
  });

  it("stops emitting after cleanup", () => {
    feed([{ duration: 300 }]);
    stop();
    settle();
    hide();
    expect(emitted).toHaveLength(0);
    expect(spans).toHaveLength(0);
    stop = () => {};
  });
});

describe("frame grouping and LoAF selection", () => {
  it("merges entries presented in the same frame into one processing span", () => {
    feed([
      {
        interactionId: 7,
        duration: 300,
        startTime: 1000,
        processingStart: 1020,
        processingEnd: 1100,
      },
      // An entry that is not an interaction, in the same frame with a
      // difference of less than 8 ms, increases the processing window of that
      // frame.
      {
        interactionId: 0,
        duration: 10,
        startTime: 1292,
        processingStart: 1294,
        processingEnd: 1299,
      },
    ]);
    settle();
    const a = slow()[0].attrs;
    expect(a["everr.browser.interaction.processing_duration"]).toBe(279);
    expect(a["everr.browser.interaction.presentation_delay"]).toBe(1);
  });

  it("intersects only the overlapping LoAFs, in time order", () => {
    const script = (startTime: number, duration: number, url: string) => ({
      startTime,
      duration,
      forcedStyleAndLayoutDuration: 0,
      sourceURL: url,
      sourceFunctionName: "fn",
      invokerType: "event-listener",
    });
    fire("long-animation-frame", [
      // This ends before the interaction starts, and thus the code fully
      // ignores it.
      {
        startTime: 100,
        duration: 200,
        styleAndLayoutStart: 300,
        scripts: [script(100, 200, "https://app.example/early.js")],
      },
      {
        startTime: 1010,
        duration: 200,
        styleAndLayoutStart: 1210,
        scripts: [
          // This ended before the interaction started. It is earlier work in
          // the same frame.
          script(900, 80, "https://app.example/before.js"),
          // This script has a duration of zero. Thus the code cannot divide
          // the forced layout time.
          script(1020, 0, "https://app.example/zero.js"),
          script(1020, 180, "https://app.example/culprit.js"),
          // This is shorter than the current longest script. Thus it is not
          // the cause.
          script(1030, 50, "https://app.example/minor.js"),
        ],
      },
      // This starts after the processing window, and thus the loop stops
      // here.
      {
        startTime: 5000,
        duration: 100,
        styleAndLayoutStart: 5100,
        scripts: [script(5000, 100, "https://app.example/late.js")],
      },
    ]);
    feed([
      {
        duration: 400,
        startTime: 1000,
        processingStart: 1010,
        processingEnd: 1300,
      },
    ]);
    settle();
    const a = slow()[0].attrs;
    expect(a["everr.browser.interaction.script.source_url"]).toBe(
      "https://app.example/culprit.js",
    );
    expect(a["everr.browser.interaction.script.duration"]).toBe(180);
  });

  it("counts trailing paint time when the last LoAF ends after processing", () => {
    fire("long-animation-frame", [
      {
        startTime: 1000,
        duration: 320,
        styleAndLayoutStart: 1320,
        scripts: [],
      },
    ]);
    feed([
      {
        duration: 400,
        startTime: 1000,
        processingStart: 1010,
        processingEnd: 1250,
      },
    ]);
    settle();
    const a = slow()[0].attrs;
    // No script is in the interaction. Thus the record has the total durations,
    // but it has no attributes for the cause.
    expect(a["everr.browser.interaction.total_script_duration"]).toBe(0);
    expect(a).not.toHaveProperty("everr.browser.interaction.script.source_url");
    // The frame continued after the processing, because 1320 is more than
    // 1250. Thus the paint continues to the next paint.
    expect(a["everr.browser.interaction.total_paint_duration"]).toBe(80);
  });
});

describe("candidate list and epochs", () => {
  it("tracks only the ten longest interactions", () => {
    feed(
      Array.from({ length: 12 }, (_, i) => ({
        interactionId: 7 * (i + 1),
        duration: 200 + i * 8,
        startTime: 1000 + i * 2000,
      })),
    );
    hide();
    // The longest interaction still gives the INP, after the code removed the
    // shortest candidates from the full list.
    expect(vitals()[0].attrs?.["browser.web_vital.value"]).toBe(288);
  });

  it("counts a sub-threshold first input as the INP candidate", () => {
    fire("first-input", [
      entry({ entryType: "first-input", interactionId: 0, duration: 60 }),
    ]);
    vi.advanceTimersByTime(0);
    hide();
    expect(vitals()).toHaveLength(1);
    expect(vitals()[0].attrs?.["browser.web_vital.value"]).toBe(60);
  });

  it("drops entries still queued for idle processing at stop", () => {
    fire("event", [entry({ duration: 300 })]);
    stop();
    vi.advanceTimersByTime(1_000);
    expect(emitted).toHaveLength(0);
    expect(spans).toHaveLength(0);
    stop = () => {};
  });

  it("returns an inert stop when event observation is unsupported", () => {
    class ThrowingPO {
      observe() {
        throw new TypeError("unsupported");
      }
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal("PerformanceObserver", ThrowingPO);
    const stopInert = startInp(emit, tracer, true, true);
    expect(() => stopInert()).not.toThrow();
    expect(emitted).toHaveLength(0);
  });

  it("ignores visibility changes that stay visible", () => {
    feed([{ duration: 250, interactionId: 7 }]);
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    expect(vitals()).toHaveLength(0);
  });

  it("ignores a non-persisted pageshow", () => {
    feed([{ duration: 250, interactionId: 7 }]);
    settle();
    hide();
    expect(vitals()).toHaveLength(1);
    window.dispatchEvent(new Event("pageshow"));
    hide();
    // The code started no new navigation period. Thus the SDK sends a maximum
    // of one vital record.
    expect(vitals()).toHaveLength(1);
  });
});

describe("latency selection", () => {
  it("keeps the max-duration entry when a shorter one follows", () => {
    feed([{ duration: 240, interactionId: 7 }]);
    feed([{ duration: 210, interactionId: 7 }]);
    settle();
    expect(slow()[0].duration).toBe(240);
  });
});

describe("frame merge boundary", () => {
  const processingOf = (secondStart: number) => {
    emitted = [];
    feed([
      {
        interactionId: 7,
        duration: 300,
        startTime: 1000,
        processingStart: 1020,
        processingEnd: 1100,
      },
      // An entry with a near render time. The code puts it in the same frame
      // only when the difference is less than 8 ms.
      {
        interactionId: 0,
        duration: 10,
        startTime: secondStart,
        processingStart: secondStart + 1,
        processingEnd: 1299,
      },
    ]);
    settle();
    return slow()[0].attrs["everr.browser.interaction.processing_duration"];
  };

  it("merges frames at exactly 8ms apart, splits at 9", () => {
    expect(processingOf(1298)).toBe(279); // renderTime 1308, |diff| == 8
  });

  it("keeps frames separate at 9ms apart", () => {
    expect(processingOf(1299)).toBe(80); // renderTime 1309: own frame
  });
});
