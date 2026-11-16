import { describe, expect, it } from "vite-plus/test";
import {
  clock,
  gapLabels,
  hasFullSnapshot,
  startOffsetMs,
  throughClipEnd,
  timelineModel,
} from "./clip-model";

const T = 1_700_000_000_000;
const clip = (focusStartMs: number, focusEndMs = focusStartMs) => ({
  startMs: T,
  endMs: T + 60_000,
  focus: { startMs: focusStartMs, endMs: focusEndMs },
});

describe("startOffsetMs", () => {
  it("starts ten seconds before the subject, measured from the first event", () => {
    expect(startOffsetMs(clip(T + 30_000), T - 500)).toBe(20_500);
  });

  it("stays inside the Clip", () => {
    expect(startOffsetMs(clip(T + 4_000), T)).toBe(0);
    expect(startOffsetMs(clip(T + 90_000), T)).toBe(60_000);
  });
});

describe("timelineModel", () => {
  it("places the focus band across the seek range", () => {
    expect(timelineModel(clip(T + 15_000, T + 30_000), T)).toEqual({
      durationMs: 60_000,
      focus: { leftPct: 25, widthPct: 25 },
    });
  });

  it("gives an instant a visible band that stays on the bar", () => {
    expect(timelineModel(clip(T + 30_000), T).focus).toEqual({ leftPct: 50, widthPct: 0.5 });
    expect(timelineModel(clip(T + 60_000), T).focus).toEqual({ leftPct: 99.5, widthPct: 0.5 });
  });
});

describe("gapLabels", () => {
  it("counts the gaps of each kind", () => {
    expect(
      gapLabels([
        { kind: "index", streamId: "s", after: 1, missing: 2 },
        { kind: "piece", streamId: "s", eventIndex: 4 },
        { kind: "conflict", streamId: "s", segmentIndex: 5 },
        { kind: "conflict", streamId: "s", segmentIndex: 6 },
      ]),
    ).toEqual(["2 missing segments", "1 incomplete event", "2 conflicting segments"]);
    expect(gapLabels([])).toEqual([]);
  });
});

describe("hasFullSnapshot", () => {
  it("needs a full snapshot event to draw anything", () => {
    expect(hasFullSnapshot([{ type: 4, timestamp: T, data: {} }])).toBe(false);
    expect(
      hasFullSnapshot([
        { type: 4, timestamp: T, data: {} },
        { type: 2, timestamp: T, data: {} },
      ]),
    ).toBe(true);
  });
});

describe("clock", () => {
  it("reads minutes and seconds", () => {
    expect(clock(52_400)).toBe("0:52");
    expect(clock(125_000)).toBe("2:05");
  });
});

describe("throughClipEnd", () => {
  const events = [
    { type: 2, timestamp: T, data: {} },
    { type: 3, timestamp: T + 8_000, data: {} },
  ];

  it("ends the events at the Clip's end, so a quiet tail still plays", () => {
    expect(throughClipEnd(events, T + 12_000)).toEqual([
      ...events,
      { type: 5, timestamp: T + 12_000, data: { tag: "everr.clip.end", payload: {} } },
    ]);
  });

  it("leaves events that already reach the end as they are", () => {
    expect(throughClipEnd(events, T + 8_000)).toBe(events);
    expect(throughClipEnd([], T)).toEqual([]);
  });
});
