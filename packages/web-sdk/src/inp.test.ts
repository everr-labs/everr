import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Emit } from "./emitter.js";
import { startInp } from "./inp.js";

// jsdom has neither Event Timing nor PerformanceObserver entries: the tests
// stub PerformanceEventTiming (for the feature gate) and PerformanceObserver
// (capturing the per-type callbacks), then drive entries by hand. Timers are
// faked: entry processing defers via the idle path (setTimeout fallback) and
// slow records settle on a 1s timer.

let emitted: Array<{ name: string; attrs?: Record<string, unknown> }>;
let stop: () => void;

const emit: Emit = (name, attrs) => {
  emitted.push({ name, attrs });
};

const names = () => emitted.map((e) => e.name);
const slow = () =>
  emitted.filter((e) => e.name === "everr.browser.slow_interaction");
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

/** Feed event entries and run the deferred idle processing. */
function feed(entries: Partial<FakeEntry>[]) {
  fire("event", entries.map(entry));
  vi.advanceTimersByTime(0);
}

/** Settle pending slow interactions. */
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
  document.body.innerHTML = "";
  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    configurable: true,
  });
  stubTiming();
  stop = startInp(emit, true, true);
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

    expect(names()).toEqual(["everr.browser.slow_interaction"]);
    const a = slow()[0].attrs ?? {};
    expect(a["everr.interaction.id"]).toBe(7);
    expect(a["everr.interaction.name"]).toBe("click");
    expect(a["everr.interaction.duration_ms"]).toBe(240);
    expect(a["everr.interaction.type"]).toBe("pointer");
    expect(a["everr.element.tag"]).toBe("button");
    expect(a["everr.element.selector"]).toBe("#b");
    expect(a["everr.element.text"]).toBe("Go");
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
    const a = slow()[0].attrs ?? {};
    expect(a["everr.interaction.input_delay_ms"]).toBe(100);
    expect(a["everr.interaction.processing_duration_ms"]).toBe(150);
    // presentation = nextPaint (1000+400) - processingEnd (1250)
    expect(a["everr.interaction.presentation_delay_ms"]).toBe(150);
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
    expect(slow()[0].attrs?.["everr.interaction.type"]).toBe("keyboard");
  });

  it("keeps the record but drops element identity for guarded elements", () => {
    document.body.innerHTML =
      '<div class="everr-no-capture"><button id="x">Hidden</button></div>';
    feed([{ duration: 320, target: document.getElementById("x") }]);
    settle();
    expect(slow()).toHaveLength(1);
    const a = slow()[0].attrs ?? {};
    expect(a["everr.interaction.duration_ms"]).toBe(320);
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
    const a = slow()[0].attrs ?? {};
    expect(a["everr.interaction.script.source_url"]).toBe(
      "https://app.example/bundle.js",
    );
    expect(a["everr.interaction.script.function_name"]).toBe("renderList");
    expect(a["everr.interaction.script.invoker_type"]).toBe("event-listener");
    expect(a["everr.interaction.script.duration_ms"]).toBe(280);
    // The category breakdown across intersecting frames: 280ms of script,
    // and the rest of the 400ms interaction unattributed by LoAF data.
    expect(a["everr.interaction.total_script_duration_ms"]).toBe(280);
    expect(a["everr.interaction.total_style_and_layout_duration_ms"]).toBe(0);
    expect(a["everr.interaction.total_paint_duration_ms"]).toBe(0);
    expect(a["everr.interaction.total_unattributed_duration_ms"]).toBe(120);
  });

  it("takes the target from any entry that carries one (often only pointerdown does)", () => {
    document.body.innerHTML = '<button id="b">Go</button>';
    const target = document.getElementById("b");
    feed([
      { name: "pointerdown", duration: 220, interactionId: 7, target },
      { name: "click", duration: 300, interactionId: 7, target: null },
    ]);
    settle();
    const a = slow()[0].attrs ?? {};
    expect(a["everr.interaction.duration_ms"]).toBe(300);
    expect(a["everr.element.selector"]).toBe("#b");
  });

  it("keeps the element payload when the target is removed before settling", () => {
    document.body.innerHTML = '<dialog><button id="close">X</button></dialog>';
    const target = document.getElementById("close");
    feed([{ duration: 260, target }]);
    // The clicked button leaves the DOM (dialog dismissed) before the settle
    // window ends; entry.target would now read null, but the payload was
    // captured eagerly at processing time.
    target?.remove();
    settle();
    const a = slow()[0].attrs ?? {};
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
    expect(a["everr.landing.path"]).toBe(location.pathname);
    // The join key back to the slow_interaction record, and the same
    // attribution keys that record carries.
    expect(a["everr.interaction.id"]).toBe(14);
    expect(a["everr.interaction.input_delay_ms"]).toBe(20);
    expect(a["everr.interaction.type"]).toBe("pointer");
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
    // 60 interactions (ids spaced by 7, Chrome's increment, feeding the
    // interactionCount estimate): index floor(60/50) = 1, the second worst.
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

    // Restore from bfcache: the page comes back visible and the restored
    // navigation measures its own INP from scratch.
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
    // The old 620ms candidate is gone; the restored epoch reports its own.
    expect(second["browser.web_vital.value"]).toBe(210);
    expect(second["browser.web_vital.id"]).not.toBe(
      first["browser.web_vital.id"],
    );
    expect(second["everr.browser.web_vital.navigation_type"]).toBe(
      "back-forward-cache",
    );
  });
});

describe("lifecycle", () => {
  it("is a no-op without Event Timing support", () => {
    stop();
    vi.unstubAllGlobals();
    const noop = startInp(emit, true, true);
    noop();
    expect(emitted).toHaveLength(0);
    stop = () => {};
  });

  it("stops emitting after cleanup", () => {
    feed([{ duration: 300 }]);
    stop();
    settle();
    hide();
    expect(emitted).toHaveLength(0);
    stop = () => {};
  });
});
