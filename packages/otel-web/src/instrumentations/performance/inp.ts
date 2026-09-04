/// <reference path="../../dom.d.ts" />
import type { Tracer } from "@opentelemetry/api";
import type { AttrValue, Emit } from "../../pipeline/emitter.js";
import { elementAttrs, guardOf } from "../element.js";
import { emitVital, scriptAttrs, whenIdleOrHidden } from "./shared.js";

// The measurement of the interaction latency. One Event Timing observer gives
// the data for two outputs.
//
// 1. The `slow_interaction` spans. The code makes one CLIENT span for each
//    interaction of the user with a latency of more than 200 ms. That value is
//    the limit for the INP rating "needs improvement". The code completes a
//    maximum of one span for each interactionId, after a short wait. The span
//    starts at the input and ends at the next paint. Its timestamps are
//    relative to the time origin, and the latency is its duration. It carries
//    the element data, the durations of the phases (the input delay, the
//    processing, and the presentation), and the script attribution from a Long
//    Animation Frame when the browser gives one. Chrome 123 and the later
//    versions give it.
// 2. The INP web vital, which is a `browser.web_vital` record with name=inp. It
//    is the longest interaction at the estimated p98. The SDK sends it one time,
//    when the page becomes hidden the first time. Its attribution uses the same
//    `everr.browser.interaction.*` and `everr.element.*` names as the
//    slow_interaction span, and it does not use the key names from web-vitals.
//    The `everr.browser.interaction.id` attribute connects it to the
//    slow_interaction span of the same interaction.
//
// This code comes from the GoogleChrome/web-vitals library
// (https://github.com/GoogleChrome/web-vitals, copyright Google LLC, Apache
// License 2.0). That code groups the entries by interactionId and uses the
// maximum entry duration as the latency. It keeps a list of the 10 longest
// interactions and uses the p98 index min(floor(interactionCount / 50), 9). It
// groups the frames by their render time, it finds the LoAF frames that are in
// the interaction, it selects the longest script, and it limits the next paint
// time and the processing end time. This module replaces the onINP function of
// that library. Thus the SDK gives an attribution for each slow interaction, and
// not only for the final INP interaction.
//
// This module is different from web-vitals in three conditions. Each difference
// decreases the number of bytes in the build. First, the code calculates
// interactionCount from the ids that this observer receives, and it does not
// operate a second observer with a threshold of 0. Second, navigationType
// ignores the prerender state and the wasDiscarded value. Third, the SDK sends
// a maximum of one INP record in each navigation period. The previous code in
// webvitals.ts removed the duplicates, and it also discarded the additional
// reports of web-vitals. Thus the records on the network do not change.

type Attrs = Record<string, AttrValue | null | undefined>;

// The browser rounds an Event Timing duration to 8 ms. Thus 40 ms is
// approximately 2.5 frames at 60 Hz. The web-vitals library uses this value as
// the minimum duration for an entry that can give the INP.
const OBSERVE_THRESHOLD = 40;
const SLOW_THRESHOLD = 200;
const MAX_CANDIDATES = 10;
// The browser can give an event entry and a LoAF entry in an incorrect
// sequence, with a difference of one frame or two frames. Thus the code keeps a
// small buffer of the recent frames, and a late entry can find its group.
const MAX_PENDING_FRAMES = 10;
// The entries of one interaction are pointerdown, pointerup, and click. The
// observer can give them in different batches. Thus the code keeps the record
// for a short time, and the entry with the maximum duration wins.
const SETTLE_MS = 1_000;

/** The entries that the browser showed in the same animation frame, with their
 * times together. */
type Frame = {
  startTime: number;
  processingStart: number;
  processingEnd: number;
  renderTime: number;
};

type Interaction = {
  id: number;
  latency: number;
  entry: PerformanceEventTiming;
  frame: Frame;
  // The element data. The code captures it immediately from the first entry
  // that has a target. Frequently only the pointerdown entry has one. The
  // `entry.target` value is null after the browser removes the node from the
  // DOM. The wait for the slow record and the INP record at the hidden time can
  // both continue after the node goes out of the DOM, for example the button of
  // a dialog that the user closes.
  //
  // The `elementSeen` flag records the capture, and `attrs` does not. A target
  // that the privacy limits refuse gives attrs with the value undefined, and a
  // later entry must not examine that target again.
  elementSeen?: boolean;
  attrs?: Attrs;
};

// The `vital` flag and the `slow` flag control the two outputs separately, and
// the two outputs use this one observer. A caller does not call startInp when
// the two flags are false.
export function startInp(
  emit: Emit,
  tracer: Tracer,
  vital: boolean,
  slow: boolean,
): () => void {
  if (
    !(
      globalThis.PerformanceEventTiming &&
      "interactionId" in PerformanceEventTiming.prototype
    )
  ) {
    return () => {};
  }

  let stopped = false;

  // --- interactionCount. The browser can give this value. If not, the code
  // calculates it from the ids, because Chrome increases an interaction id by 7
  // for each interaction. ---
  let minKnownId = Infinity;
  let maxKnownId = 0;
  const interactionCount = () =>
    (performance as { interactionCount?: number }).interactionCount ??
    (maxKnownId ? (maxKnownId - minKnownId) / 7 + 1 : 0);
  // The p98 calculation uses only the current navigation. When the browser
  // gives the page from the bfcache, the code records the count and starts a new
  // list of the candidates.
  let prevInteractionCount = 0;

  // --- The list of the 10 longest interactions. ---
  let candidates: Interaction[] = [];
  const candidateMap = new Map<number, Interaction>();

  // --- The groups of the frames. They give processingEnd for all the entries
  // in one frame. ---
  let frames: Frame[] = [];
  let latestProcessingEnd = 0;

  // --- The buffer of the LoAF entries. ---
  let pendingLoAFs: PerformanceLongAnimationFrameTiming[] = [];

  // --- The data for the wait before a slow interaction record. ---
  type PendingSlow = {
    interaction: Interaction;
    timer: ReturnType<typeof setTimeout>;
  };
  const pendingSlow = new Map<number, PendingSlow>();
  const sentSlow = new Set<number>();

  // --- The navigation period of the INP vital. The code starts a new period
  // when the browser gives the page from the bfcache. ---
  let vitalReported = false;
  let restored = false;

  const groupByRenderTime = (entry: PerformanceEventTiming): Frame => {
    const renderTime = entry.startTime + entry.duration;
    latestProcessingEnd = Math.max(latestProcessingEnd, entry.processingEnd);
    // The loop uses the opposite sequence, because the most recent frame is
    // usually the correct frame. A difference of less than 8 ms from the render
    // time of a frame in the list means the same frame.
    for (let i = frames.length - 1; i >= 0; i--) {
      const frame = frames[i];
      if (Math.abs(renderTime - frame.renderTime) <= 8) {
        frame.startTime = Math.min(entry.startTime, frame.startTime);
        frame.processingStart = Math.min(
          entry.processingStart,
          frame.processingStart,
        );
        frame.processingEnd = Math.max(
          entry.processingEnd,
          frame.processingEnd,
        );
        return frame;
      }
    }
    const frame: Frame = {
      startTime: entry.startTime,
      processingStart: entry.processingStart,
      processingEnd: entry.processingEnd,
      renderTime,
    };
    frames.push(frame);
    return frame;
  };

  const intersectingLoAFs = (start: number, end: number) => {
    const out: PerformanceLongAnimationFrameTiming[] = [];
    for (const loaf of pendingLoAFs) {
      if (loaf.startTime + loaf.duration < start) continue;
      // The pendingLoAFs list is in the sequence of the times. Thus each
      // subsequent entry starts later.
      if (loaf.startTime > end) break;
      out.push(loaf);
    }
    return out;
  };

  const cleanup = () => {
    // The code keeps the frames of a current candidate and the frames of a slow
    // record that waits. It also keeps the most recent MAX_PENDING_FRAMES
    // frames, for the entries that come late or in an incorrect sequence.
    const live = new Set<Frame>(candidates.map((i) => i.frame));
    for (const { interaction } of pendingSlow.values())
      live.add(interaction.frame);
    const minIndexToKeep = frames.length - MAX_PENDING_FRAMES;
    frames = frames.filter((f, i) => i >= minIndexToKeep || live.has(f));
    // The code keeps a LoAF entry that is in a frame that it keeps. It also
    // keeps a LoAF entry that starts after all the entries that it processed,
    // because that entry can belong to a subsequent interaction.
    const liveLoAFs = new Set<PerformanceLongAnimationFrameTiming>();
    for (const f of frames) {
      for (const loaf of intersectingLoAFs(f.startTime, f.processingEnd)) {
        liveLoAFs.add(loaf);
      }
    }
    pendingLoAFs = pendingLoAFs.filter(
      (loaf) => loaf.startTime > latestProcessingEnd || liveLoAFs.has(loaf),
    );
  };

  const processEntry = (entry: PerformanceEventTiming) => {
    if (entry.interactionId) {
      minKnownId = Math.min(minKnownId, entry.interactionId);
      maxKnownId = Math.max(maxKnownId, entry.interactionId);
    }
    const frame = groupByRenderTime(entry);
    if (!(entry.interactionId || entry.entryType === "first-input")) return;

    const id = entry.interactionId || 0;
    let interaction = candidateMap.get(id) ?? pendingSlow.get(id)?.interaction;
    if (interaction) {
      if (entry.duration > interaction.latency) {
        interaction.latency = entry.duration;
        interaction.entry = entry;
        interaction.frame = frame;
      }
    } else {
      interaction = { id, latency: entry.duration, entry, frame };
    }
    if (!interaction.elementSeen && entry.target instanceof Element) {
      interaction.elementSeen = true;
      // For the privacy, the code removes the element data when the privacy
      // limits refuse the element. Those limits refuse an element with the
      // everr-no-capture class, a password input, and a hidden input. But the
      // code always keeps the interaction, because the latency is correct and
      // useful for each element.
      const el = guardOf(entry.target);
      if (el) interaction.attrs = elementAttrs(el);
    }

    // The list of the candidates. The code keeps an interaction only when that
    // interaction can be one of the ten longest, or when it is one of them
    // already.
    if (
      candidateMap.has(id) ||
      candidates.length < MAX_CANDIDATES ||
      interaction.latency > candidates[candidates.length - 1].latency
    ) {
      if (!candidateMap.has(id)) {
        candidateMap.set(id, interaction);
        candidates.push(interaction);
      }
      candidates.sort((a, b) => b.latency - a.latency);
      for (const dropped of candidates.splice(MAX_CANDIDATES)) {
        candidateMap.delete(dropped.id);
      }
    }

    // The slow record. The code waits, then it sends a maximum of one record
    // for each interactionId.
    if (slow && id && !sentSlow.has(id)) {
      const pending = pendingSlow.get(id);
      if (pending) clearTimeout(pending.timer);
      if (pending || interaction.latency >= SLOW_THRESHOLD) {
        const next: PendingSlow = {
          interaction,
          timer: setTimeout(() => finalizeSlow(id, next), SETTLE_MS),
        };
        pendingSlow.set(id, next);
      }
    }
  };

  const handleEntries = (entries: PerformanceEventTiming[]) => {
    // The code waits for the next idle period. Thus the browser probably gave
    // each entry between the interaction and its next paint.
    whenIdleOrHidden(() => {
      if (stopped) return;
      for (const entry of entries) processEntry(entry);
      cleanup();
    });
  };

  // The callers control this timer. The code clears the timer at each new
  // start, at each completion, and at the stop. Thus when the timer operates,
  // its entry is always the current entry.
  const finalizeSlow = (id: number, pending: PendingSlow) => {
    clearTimeout(pending.timer);
    pendingSlow.delete(id);
    sentSlow.add(id);
    const { entry, frame, latency, attrs } = pending.interaction;
    // The span goes from the input to the next paint. The startTime value gives
    // its position on the trace timeline, and the latency is its duration. Thus
    // the span needs no attribute for the duration.
    const start = Math.round(performance.timeOrigin + entry.startTime);
    tracer
      .startSpan("slow_interaction", {
        startTime: start,
        attributes: {
          ...attrs,
          "everr.browser.interaction.id": id,
          "everr.browser.interaction.name": entry.name,
          ...phaseAttrs(entry, frame, intersectingLoAFs),
        },
      })
      .end(start + Math.round(latency));
  };

  const reportVital = () => {
    if (!vital || vitalReported) return;
    const inp =
      candidates[
        Math.min(
          candidates.length - 1,
          Math.floor((interactionCount() - prevInteractionCount) / 50),
        )
      ];
    if (!inp) return;
    vitalReported = true;
    const { entry, frame, latency, id, attrs } = inp;
    // The attribution uses the same names as the slow_interaction record,
    // including the element data. It does not use the key names from
    // web-vitals. Thus the vital and the slow record that it connects to give
    // the same information with the same keys.
    emitVital(
      emit,
      "inp",
      latency,
      restored,
      {
        "everr.browser.interaction.id": id,
        "everr.browser.interaction.name": entry.name,
        ...attrs,
        ...phaseAttrs(entry, frame, intersectingLoAFs),
      },
      entry.startTime,
    );
  };

  let po: PerformanceObserver | undefined;
  let loafPo: PerformanceObserver | undefined;
  try {
    po = new PerformanceObserver((list) =>
      handleEntries(list.getEntries() as PerformanceEventTiming[]),
    );
    po.observe({
      type: "event",
      buffered: true,
      durationThreshold: OBSERVE_THRESHOLD,
    } as PerformanceObserverInit);
    // The observer also receives the first-input entry. Thus it gets a first
    // interaction with a duration below the limit.
    po.observe({ type: "first-input", buffered: true });
  } catch {
    return () => {};
  }
  try {
    loafPo = new PerformanceObserver((list) => {
      pendingLoAFs = pendingLoAFs.concat(
        list.getEntries() as PerformanceLongAnimationFrameTiming[],
      );
    });
    loafPo.observe({ type: "long-animation-frame", buffered: true });
  } catch {
    // Chrome 123 and the later versions have LoAF. Without it, the records
    // carry no script attributes.
  }

  const onVisibilityChange = () => {
    if (document.visibilityState !== "hidden") return;
    // The code processes the entries that the observer received but did not
    // give. Then it completes each slow record that waits. Then it sends the
    // INP record. All these steps occur before the hidden listener of the
    // emitter does the exit flush, because the SDK registers that listener
    // later.
    handleEntries(po.takeRecords() as PerformanceEventTiming[]);
    for (const [id, pending] of [...pendingSlow]) finalizeSlow(id, pending);
    reportVital();
  };
  addEventListener("visibilitychange", onVisibilityChange, true);

  // The browser gives the page from the bfcache. This starts a new navigation
  // period. The code clears the candidates and the initial count. Thus the page
  // sends its own INP record with its own metric id. The code keeps the ids of
  // the slow interactions that it sent, and thus it does not send them again.
  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    restored = true;
    prevInteractionCount = interactionCount();
    candidates = [];
    candidateMap.clear();
    vitalReported = false;
  };
  addEventListener("pageshow", onPageShow, true);

  return () => {
    stopped = true;
    po.disconnect();
    loafPo?.disconnect();
    removeEventListener("visibilitychange", onVisibilityChange, true);
    removeEventListener("pageshow", onPageShow, true);
    for (const { timer } of pendingSlow.values()) clearTimeout(timer);
    pendingSlow.clear();
  };
}

/**
 * The shared attribution data. It contains the durations of the phases and the
 * script attribution from the LoAF entries. The slow_interaction record and the
 * INP vital both carry it, and they use the one set of
 * `everr.browser.interaction.*` names.
 */
function phaseAttrs(
  entry: PerformanceEventTiming,
  frame: Frame,
  intersecting: (
    start: number,
    end: number,
  ) => PerformanceLongAnimationFrameTiming[],
): Attrs {
  const interactionTime = entry.startTime;
  const processingStart = entry.processingStart;
  // The browser decreases a duration to a multiple of 8 ms. Thus the code makes
  // the next paint time later than the start of the processing. Then it makes
  // the end of the processing earlier than the next paint. Thus synchronous
  // work that continues after the duration of the event, for example a call to
  // alert(), is never longer than the latency.
  const nextPaintTime = Math.max(
    entry.startTime + entry.duration,
    processingStart,
  );
  const processingEnd = Math.min(frame.processingEnd, nextPaintTime);
  const inputDelay = processingStart - interactionTime;
  const processingDuration = processingEnd - processingStart;

  const attrs: Attrs = {
    "everr.browser.interaction.type": entry.name.startsWith("key")
      ? "keyboard"
      : "pointer",
    "everr.browser.interaction.input_delay": inputDelay,
    "everr.browser.interaction.processing_duration": processingDuration,
    "everr.browser.interaction.presentation_delay":
      nextPaintTime - processingEnd,
  };

  // The LoAF calculation. It gives the duration of each category in the frames
  // that are in the interaction: the script, the style and the layout, the
  // paint, and the part without a category. It also gives the longest script,
  // which is the useful cause. A script that ended before the interaction
  // started is earlier work in the same frame, and it is not a cause.
  const loafs = intersecting(entry.startTime, processingEnd);
  if (!loafs.length) return attrs;

  let totalScript = 0;
  let totalStyleAndLayout = 0;
  let totalPaint = 0;
  let longestDuration = 0;
  let longest: PerformanceScriptTiming | undefined;
  for (const loaf of loafs) {
    totalStyleAndLayout +=
      loaf.startTime + loaf.duration - loaf.styleAndLayoutStart;
    for (const script of loaf.scripts) {
      const scriptEnd = script.startTime + script.duration;
      if (scriptEnd < interactionTime) continue;
      const intersectingDuration =
        scriptEnd - Math.max(interactionTime, script.startTime);
      // The forcedStyleAndLayout value has no timestamps. Thus the code divides
      // it by the part of the script that is in the interaction. It counts that
      // duration as style and layout, the same as DevTools, and not as script
      // time.
      const forced = script.duration
        ? (intersectingDuration / script.duration) *
          script.forcedStyleAndLayoutDuration
        : 0;
      totalScript += intersectingDuration - forced;
      totalStyleAndLayout += forced;
      if (intersectingDuration > longestDuration) {
        longestDuration = intersectingDuration;
        longest = script;
      }
    }
  }
  const lastLoaf = loafs[loafs.length - 1];
  const lastLoafEnd = lastLoaf.startTime + lastLoaf.duration;
  if (lastLoafEnd >= interactionTime + inputDelay + processingDuration) {
    totalPaint = nextPaintTime - lastLoafEnd;
  }

  return Object.assign(
    attrs,
    {
      "everr.browser.interaction.total_script_duration": totalScript,
      "everr.browser.interaction.total_style_and_layout_duration":
        totalStyleAndLayout,
      "everr.browser.interaction.total_paint_duration": totalPaint,
      "everr.browser.interaction.total_unattributed_duration":
        nextPaintTime -
        interactionTime -
        totalScript -
        totalStyleAndLayout -
        totalPaint,
    },
    longest &&
      scriptAttrs("everr.browser.interaction", longest, longestDuration),
  );
}
