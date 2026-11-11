import { describe, expect, it } from "vite-plus/test";
import type { ProfileTimelineStack } from "../data/types";
import { buildSpanTimeline, MAX_TIMELINE_BUCKETS } from "./span-timeline";

const START = 1_794_352_829_000_000_000n;
const MS = 1_000_000;

function stack(leaf: string, offsetsMs: number[]): ProfileTimelineStack {
  return {
    frames: [
      { name: "main", file: "", line: 0 },
      { name: leaf, file: "", line: 0 },
    ],
    value: offsetsMs.length,
    timestampsNs: offsetsMs.map((ms) => String(START + BigInt(ms * MS))),
  };
}

describe("buildSpanTimeline", () => {
  it("puts each sample in the column of its sampling period", () => {
    const timeline = buildSpanTimeline(
      [stack("hash", [1, 25]), stack("parse", [12])],
      { startNs: START, durationNs: 30 * MS },
      10 * MS,
    );
    expect(timeline.bucketCount).toBe(3);
    expect(timeline.samples).toBe(3);
    expect(timeline.buckets.map((b) => [b.index, b.leaf])).toEqual([
      [0, "hash"],
      [1, "parse"],
      [2, "hash"],
    ]);
  });

  it("shows the most sampled stack when samples share a column", () => {
    const timeline = buildSpanTimeline(
      [stack("hash", [1]), stack("parse", [2, 3])],
      { startNs: START, durationNs: 10 * MS },
      10 * MS,
    );
    expect(timeline.buckets).toHaveLength(1);
    expect(timeline.buckets[0]).toMatchObject({ leaf: "parse", samples: 3 });
  });

  it("caps the columns for long spans", () => {
    const timeline = buildSpanTimeline(
      [stack("hash", [0, 60_000])],
      { startNs: START, durationNs: 60_000 * MS },
      10 * MS,
    );
    expect(timeline.bucketCount).toBe(MAX_TIMELINE_BUCKETS);
    expect(timeline.buckets.map((b) => b.index)).toEqual([0, MAX_TIMELINE_BUCKETS - 1]);
  });

  it("drops samples outside the span", () => {
    const timeline = buildSpanTimeline(
      [stack("hash", [-5, 50])],
      { startNs: START, durationNs: 20 * MS },
      10 * MS,
    );
    expect(timeline.samples).toBe(0);
    expect(timeline.buckets).toEqual([]);
  });

  it("assumes 100 Hz when the profile reports no period", () => {
    const timeline = buildSpanTimeline([], { startNs: START, durationNs: 40 * MS }, 0);
    expect(timeline.bucketCount).toBe(4);
  });
});
