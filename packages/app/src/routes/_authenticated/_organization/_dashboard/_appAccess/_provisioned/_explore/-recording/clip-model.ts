import type { CoveringClip } from "@everr/telemetry-explorer/recordings";
import type { RecordedEvent, RecordingGap } from "#app/data/replay/options.ts";

/** Playback starts this far before the subject so the lead-up is on screen. */
const LEAD_IN_MS = 10_000;
const FULL_SNAPSHOT = 2;
const CUSTOM = 5;
/** An instant focus still needs a visible band. */
const MIN_FOCUS_PCT = 0.5;

type ClipTimes = Pick<CoveringClip, "startMs" | "endMs" | "focus">;

/** Where playback starts, as an offset from the first event. */
export function startOffsetMs(clip: ClipTimes, firstEventMs: number): number {
  const target = Math.min(Math.max(clip.focus.startMs - LEAD_IN_MS, clip.startMs), clip.endMs);
  return Math.max(0, target - firstEventMs);
}

/** rrweb draws nothing without a full snapshot: the Clip's first Segment was lost. */
export function hasFullSnapshot(events: RecordedEvent[]): boolean {
  return events.some((event) => event.type === FULL_SNAPSHOT);
}

/**
 * rrweb stops at the last event, but a Clip runs to its end even when nothing
 * changed on the page. A custom event at the end, which rrweb only re-emits,
 * keeps the player running over that quiet tail to the end of the seek bar.
 */
export function throughClipEnd(events: RecordedEvent[], endMs: number): RecordedEvent[] {
  const last = events.at(-1);
  if (!last || last.timestamp >= endMs) return events;
  return [
    ...events,
    { type: CUSTOM, timestamp: endMs, data: { tag: "everr.clip.end", payload: {} } },
  ];
}

/** Gaps carry no time, so they are counted rather than placed on the timeline. */
export function gapLabels(gaps: RecordingGap[]): string[] {
  let missing = 0;
  let incomplete = 0;
  let conflicting = 0;
  for (const gap of gaps) {
    if (gap.kind === "index") missing += gap.missing;
    else if (gap.kind === "piece") incomplete += 1;
    else if (gap.kind === "conflict") conflicting += 1;
  }
  return [
    counted(missing, "missing segment"),
    counted(incomplete, "incomplete event"),
    counted(conflicting, "conflicting segment"),
  ].filter((label) => label !== undefined);
}

function counted(count: number, noun: string): string | undefined {
  if (count === 0) return undefined;
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export type TimelineModel = {
  /** Milliseconds from the first event to the Clip's end: the range of the seek bar. */
  durationMs: number;
  focus: { leftPct: number; widthPct: number };
};

export function timelineModel(clip: ClipTimes, firstEventMs: number): TimelineModel {
  const durationMs = Math.max(1, clip.endMs - firstEventMs);
  const pct = (ms: number) => Math.min(100, Math.max(0, ((ms - firstEventMs) / durationMs) * 100));
  const widthPct = Math.max(pct(clip.focus.endMs) - pct(clip.focus.startMs), MIN_FOCUS_PCT);
  return {
    durationMs,
    focus: { leftPct: Math.min(pct(clip.focus.startMs), 100 - widthPct), widthPct },
  };
}

/** `m:ss` for a playback position or a Clip's length. */
export function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
