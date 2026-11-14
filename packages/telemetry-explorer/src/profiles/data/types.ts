import type { ProfileStack } from "../model/flame-tree";
import type { ProfileSource } from "../model/source-link";

export type { ProfileSource } from "../model/source-link";
export type { ProfileVersion } from "../model/versions";

export type SampleTypeOption = {
  sampleType: string;
  sampleUnit: string;
};

export type ProfileStacks = {
  /** The heaviest distinct stacks, at most the requested limit. */
  stacks: ProfileStack[];
  /** Sum of every matching sample, including stacks beyond the limit. */
  totalValue: number;
  /** Number of distinct stacks before the limit. */
  stackCount: number;
  /**
   * Profiles averaged together, for snapshot types such as `inuse_space`,
   * where summing every snapshot in the range would count live memory again
   * for each one. Absent for types that add up over time, such as CPU.
   */
  snapshots?: number;
  /** The code revisions the stacks came from; each stack's `source` indexes into it. */
  sources?: ProfileSource[];
};

/** A trace span whose samples ran a function. */
export type ProfileExampleTrace = {
  traceId: string;
  spanId: string;
  serviceName: string;
  /** `everr.root_span.name`, empty when the profiler does not record it. */
  rootSpanName: string;
  /** Summed weight of the span's samples that ran the function. */
  value: number;
};

export type ProfileHistogramBucket = {
  timestamp: string;
  endTimestamp: string;
  /** Summed sample weight in the sample type's unit; averaged per profile for snapshot types. */
  value: number;
};

/** One distinct stack of a span's timeline, with every time it was sampled. */
export type ProfileTimelineStack = ProfileStack & {
  /** Unix nanoseconds as strings: they exceed a JS number's integer precision. */
  timestampsNs: string[];
};

export type ProfileSpanTimeline = {
  /** Most sampled first; `value` is the number of timestamps. */
  stacks: ProfileTimelineStack[];
  /** The profiler's sampling period in nanoseconds, 0 when it reports none. */
  periodNs: number;
  /** True when the samples reached the limit, so the latest ones may be missing. */
  truncated: boolean;
};
