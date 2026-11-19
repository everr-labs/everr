import type { ProfileTimelineStack } from "../data/types";
import type { ProfileStack } from "./flame-tree";

/** 100 Hz, the rate of most continuous profilers, for profiles that report no period. */
export const DEFAULT_SAMPLE_PERIOD_NS = 10_000_000;

/** Past this many columns a bar is narrower than a pixel in the span details panel. */
export const MAX_TIMELINE_BUCKETS = 240;

export type TimelineBucket = {
  /** Column of the bucket, from 0 at the span start. */
  index: number;
  samples: number;
  /** The stack sampled most often in the bucket; on a tie, the one listed first. */
  stack: ProfileStack;
  leaf: string;
};

export type SpanTimeline = {
  /** Only the buckets with samples, in time order. */
  buckets: TimelineBucket[];
  bucketCount: number;
  bucketNs: number;
  samples: number;
};

/**
 * Bins a span's timestamped samples into columns as wide as the sampling
 * period, so a sample reads as the slice of time it stands for, merging
 * neighbors once the span is too long to draw one column per period.
 */
export function buildSpanTimeline(
  stacks: readonly ProfileTimelineStack[],
  span: { startNs: bigint; durationNs: number },
  periodNs: number,
): SpanTimeline {
  const durationNs = Math.max(span.durationNs, 0);
  const period = periodNs > 0 ? periodNs : DEFAULT_SAMPLE_PERIOD_NS;
  const bucketNs = Math.max(period, durationNs / MAX_TIMELINE_BUCKETS);
  const bucketCount = Math.max(1, Math.ceil(durationNs / bucketNs));

  const counts = new Map<number, { samples: number; byStack: Map<number, number> }>();
  let samples = 0;
  stacks.forEach((stack, stackIndex) => {
    for (const timestamp of stack.timestampsNs) {
      const offset = Number(BigInt(timestamp) - span.startNs);
      if (offset < 0 || offset > durationNs) continue;
      const index = Math.min(bucketCount - 1, Math.floor(offset / bucketNs));
      let bucket = counts.get(index);
      if (!bucket) {
        bucket = { samples: 0, byStack: new Map() };
        counts.set(index, bucket);
      }
      bucket.samples++;
      bucket.byStack.set(stackIndex, (bucket.byStack.get(stackIndex) ?? 0) + 1);
      samples++;
    }
  });

  const buckets: TimelineBucket[] = [];
  for (const [index, bucket] of [...counts].sort(([a], [b]) => a - b)) {
    let top = -1;
    let topCount = 0;
    for (const [stackIndex, count] of bucket.byStack) {
      if (count > topCount || (count === topCount && stackIndex < top)) {
        top = stackIndex;
        topCount = count;
      }
    }
    const stack = stacks[top];
    if (!stack) continue;
    buckets.push({
      index,
      samples: bucket.samples,
      stack,
      leaf: stack.frames.at(-1)?.name ?? "unknown",
    });
  }
  return { buckets, bucketCount, bucketNs, samples };
}
