/// <reference path="../../dom.d.ts" />
import { elementAttrs, guardOf } from "../../element.js";
import type { AttrValue, Emit } from "../../emitter.js";
import { captureLanding, emitVital, whenIdleOrHidden } from "./shared.js";

// Interaction latency tracking: one Event Timing observer feeding two
// outputs.
//
// 1. `everr.browser.slow_interaction`: one record per user interaction whose
//    latency crosses 200ms (the INP "needs improvement" boundary), emitted
//    at most once per interactionId after a short settle window, carrying
//    the element payload, the input-delay / processing / presentation phase
//    breakdown, and Long Animation Frame script attribution where the
//    browser provides it (Chrome 123+).
// 2. The INP web vital (`browser.web_vital`, name=inp): the estimated-p98
//    longest interaction, reported once when the page first goes hidden.
//    Its attribution is the same `everr.interaction.*` / `everr.element.*`
//    vocabulary the slow_interaction record carries (not web-vitals' key
//    names), and `everr.interaction.id` joins it to the slow_interaction
//    record that is its candidate.
//
// The measurement core (interaction grouping by interactionId with latency
// as the max entry duration, the 10-longest candidate list with the
// p98 index min(floor(interactionCount / 50), 9), frame grouping by render
// time, LoAF intersection and longest-script selection, and the
// next-paint/processing-end clamps) is ported and adapted from the
// GoogleChrome/web-vitals library (https://github.com/GoogleChrome/web-vitals,
// copyright Google LLC, Apache License 2.0), replacing its onINP so every
// slow interaction is attributed, not only the final INP candidate.
//
// Deliberate divergences from web-vitals, each traded for bundle size:
// the interactionCount polyfill estimates from the ids this observer sees
// instead of running a second threshold-0 observer; navigationType skips
// the prerender/wasDiscarded refinements; and the INP record is at-most-once
// per navigation epoch (the previous webvitals.ts dedupe dropped web-vitals'
// grown-value re-reports anyway, so the wire behavior is unchanged).

type Attrs = Record<string, AttrValue | null | undefined>;

// Event Timing durations are rounded to 8ms, so 40 is ~2.5 frames at 60Hz:
// web-vitals' threshold for an entry to be worth considering for INP.
const OBSERVE_THRESHOLD = 40;
const SLOW_THRESHOLD = 200;
const MAX_CANDIDATES = 10;
// Event and LoAF entries dispatch out of order by a frame or two; keep a
// small buffer of recent frames so late entries still find their group.
const MAX_PENDING_FRAMES = 10;
// A single interaction's entries (pointerdown, pointerup, click) can span
// observer batches; hold the record briefly so the max-duration entry wins.
const SETTLE_MS = 1_000;

/** Entries presented within the same animation frame, merged timings. */
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
  // The element payload, captured eagerly from the first entry that carries
  // a target (often only pointerdown does): `entry.target` returns null once
  // the node is disconnected, and both the settle window and the hidden-time
  // INP report can outlive the clicked node (a dismissed dialog's button).
  // `elementSeen` (not `attrs`) marks capture: a guarded target captures as
  // undefined attrs, and must not be re-probed by later entries.
  elementSeen?: boolean;
  attrs?: Attrs;
};

// `vital` and `slow` gate the two outputs independently (both share this one
// observer); callers skip startInp entirely when both are off.
export function startInp(
  emit: Emit,
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

  captureLanding();
  let stopped = false;

  // --- interactionCount (native, or estimated from ids: Chrome assigns
  // interaction ids in increments of 7) ---
  let minKnownId = Infinity;
  let maxKnownId = 0;
  const interactionCount = () =>
    (performance as { interactionCount?: number }).interactionCount ??
    (maxKnownId ? (maxKnownId - minKnownId) / 7 + 1 : 0);
  // p98 estimation only considers the current navigation: bfcache restores
  // snapshot the count and candidates start over.
  let prevInteractionCount = 0;

  // --- the 10-longest candidate list ---
  let candidates: Interaction[] = [];
  const candidateMap = new Map<number, Interaction>();

  // --- frame grouping (for processingEnd across all entries in a frame) ---
  let frames: Frame[] = [];
  let latestProcessingEnd = 0;

  // --- LoAF buffer ---
  let pendingLoAFs: PerformanceLongAnimationFrameTiming[] = [];

  // --- slow interaction settle state ---
  const pendingSlow = new Map<
    number,
    { interaction: Interaction; timer: ReturnType<typeof setTimeout> }
  >();
  const sentSlow = new Set<number>();

  // --- INP vital epoch (reset on bfcache restore) ---
  let vitalReported = false;
  let restored = false;

  const groupByRenderTime = (entry: PerformanceEventTiming): Frame => {
    const renderTime = entry.startTime + entry.duration;
    latestProcessingEnd = Math.max(latestProcessingEnd, entry.processingEnd);
    // Reverse order: the most likely match is the most recent frame. Within
    // 8ms of an existing frame's render time means the same frame.
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
      // pendingLoAFs is in time order: everything after starts later still.
      if (loaf.startTime > end) break;
      out.push(loaf);
    }
    return out;
  };

  const cleanup = () => {
    // Keep frames that back a current candidate or pending slow record, plus
    // the most recent MAX_PENDING_FRAMES for out-of-order stragglers.
    const live = new Set<Frame>(candidates.map((i) => i.frame));
    for (const { interaction } of pendingSlow.values())
      live.add(interaction.frame);
    const minIndexToKeep = frames.length - MAX_PENDING_FRAMES;
    frames = frames.filter((f, i) => i >= minIndexToKeep || live.has(f));
    // Keep LoAFs that intersect a kept frame or postdate everything
    // processed so far (they may match entries still to come).
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
      // Privacy: a guarded element (everr-no-capture, password/hidden input)
      // drops the element payload, never the interaction; the latency is
      // real and actionable regardless of what was interacted with.
      const el = guardOf(entry.target);
      if (el) interaction.attrs = elementAttrs(el);
    }

    // Candidate list: only worth tracking if it could be one of the ten
    // longest (or already is).
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

    // Slow record: settle, then emit at most once per interactionId.
    if (slow && id && !sentSlow.has(id)) {
      const pending = pendingSlow.get(id);
      if (pending) clearTimeout(pending.timer);
      if (pending || interaction.latency >= SLOW_THRESHOLD) {
        pendingSlow.set(id, {
          interaction,
          timer: setTimeout(() => finalizeSlow(id), SETTLE_MS),
        });
      }
    }
  };

  const handleEntries = (entries: PerformanceEventTiming[]) => {
    // Next idle task: raises the odds that every entry between the
    // interaction and its next paint has been dispatched.
    whenIdleOrHidden(() => {
      if (stopped) return;
      for (const entry of entries) processEntry(entry);
      cleanup();
    });
  };

  const finalizeSlow = (id: number) => {
    const pending = pendingSlow.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingSlow.delete(id);
    sentSlow.add(id);
    const { entry, frame, latency, attrs } = pending.interaction;
    emit("everr.browser.slow_interaction", {
      ...attrs,
      "everr.interaction.id": id,
      "everr.interaction.name": entry.name,
      "everr.interaction.duration_ms": latency,
      ...phaseAttrs(entry, frame, intersectingLoAFs),
    });
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
    // Attribution is the slow_interaction vocabulary verbatim (element
    // payload included), not web-vitals' key names: the vital and the slow
    // record it joins to answer the same question with the same keys.
    emitVital(emit, "inp", latency, restored, {
      "everr.interaction.id": id,
      ...attrs,
      ...phaseAttrs(entry, frame, intersectingLoAFs),
    });
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
    // Also first-input: catches a first interaction under the threshold.
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
    // LoAF is Chrome 123+: without it records simply carry no script attrs.
  }

  const onVisibilityChange = () => {
    if (document.visibilityState !== "hidden") return;
    // Flush entries the observer has seen but not yet delivered, settle any
    // pending slow records, then report INP: all before the emitter's own
    // hidden listener (registered later in init) runs the exit flush.
    handleEntries(po.takeRecords() as PerformanceEventTiming[]);
    for (const id of [...pendingSlow.keys()]) finalizeSlow(id);
    reportVital();
  };
  addEventListener("visibilitychange", onVisibilityChange, true);

  // bfcache restore: a fresh navigation epoch. Candidates and the count
  // baseline reset so the restored page reports its own INP (with its own
  // metric id); already-sent slow interaction ids stay deduped.
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
 * The shared attribution payload: phase breakdown plus LoAF-derived script
 * attribution, one `everr.interaction.*` vocabulary carried by both the
 * slow_interaction record and the INP vital.
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
  // Durations round down to 8ms: clamp next paint after processing start.
  // Processing clamps to next paint in turn, so sync work that outlives the
  // event duration (alert() and friends) never exceeds the latency.
  const nextPaintTime = Math.max(
    entry.startTime + entry.duration,
    processingStart,
  );
  const processingEnd = Math.min(frame.processingEnd, nextPaintTime);
  const inputDelay = processingStart - interactionTime;
  const processingDuration = processingEnd - processingStart;

  const attrs: Attrs = {
    "everr.interaction.type": entry.name.startsWith("key")
      ? "keyboard"
      : "pointer",
    "everr.interaction.input_delay_ms": inputDelay,
    "everr.interaction.processing_duration_ms": processingDuration,
    "everr.interaction.presentation_delay_ms": nextPaintTime - processingEnd,
  };

  // LoAF pass: a duration breakdown by category (script, style-and-layout,
  // paint, unattributed) across the intersecting frames, plus the single
  // longest script as the actionable culprit. Scripts that ended before the
  // interaction began are earlier work in the same frame, not causes.
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
      // forcedStyleAndLayout has no timestamps: apportion it by the
      // intersecting share of the script, and count it as style-and-layout
      // (as DevTools does) rather than script time.
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

  attrs["everr.interaction.total_script_duration_ms"] = totalScript;
  attrs["everr.interaction.total_style_and_layout_duration_ms"] =
    totalStyleAndLayout;
  attrs["everr.interaction.total_paint_duration_ms"] = totalPaint;
  attrs["everr.interaction.total_unattributed_duration_ms"] =
    nextPaintTime -
    interactionTime -
    totalScript -
    totalStyleAndLayout -
    totalPaint;
  if (longest) {
    attrs["everr.interaction.script.source_url"] = longest.sourceURL;
    attrs["everr.interaction.script.function_name"] =
      longest.sourceFunctionName;
    attrs["everr.interaction.script.invoker_type"] = longest.invokerType;
    attrs["everr.interaction.script.duration_ms"] = longestDuration;
  }
  return attrs;
}
