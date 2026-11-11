import { useMemo } from "react";
import { VolumeHistogram } from "../../histogram/volume-histogram";
import type { ProfileHistogramBucket, SampleTypeOption } from "../data/types";
import { formatProfileValue } from "../model/format";
import { sampleTypeLabel } from "./profile-filters";

export function ProfileHistogram({
  buckets,
  sampleType,
  isPending,
  showVolume,
  selectingBaseline = false,
  baseline,
  onRangeSelect,
  onShowVolumeChange,
}: {
  buckets: ProfileHistogramBucket[];
  sampleType: SampleTypeOption;
  isPending: boolean;
  showVolume: boolean;
  /** Dragging picks the comparison baseline instead of zooming in. */
  selectingBaseline?: boolean;
  /** The baseline window to shade, when it falls in the chart. */
  baseline?: { from: Date; to: Date };
  onRangeSelect: (from: Date, to: Date) => void;
  onShowVolumeChange: (show: boolean) => void;
}) {
  const label = sampleTypeLabel(sampleType);
  const stack = useMemo(
    () => [{ key: "value" as const, label, color: "var(--color-sky-500)" }],
    [label],
  );
  const unit = sampleType.sampleUnit;
  const formatValue = useMemo(() => (value: number) => formatProfileValue(value, unit), [unit]);
  const highlight = baseline ? bucketSpan(buckets, baseline.from, baseline.to) : null;

  return (
    <VolumeHistogram
      title={
        selectingBaseline
          ? `${label} over time · drag to pick the baseline${highlight ? " (shaded)" : ""}`
          : `${label} over time`
      }
      emptyMessage="No samples in this range"
      buckets={buckets}
      hasData={buckets.some((bucket) => bucket.value > 0)}
      stack={stack}
      isPending={isPending}
      showVolume={showVolume}
      onRangeSelect={onRangeSelect}
      onShowVolumeChange={onShowVolumeChange}
      formatValue={formatValue}
      highlight={highlight}
    />
  );
}

/** The first and last bucket that overlap the window, inclusive; null when none does. */
export function bucketSpan(
  buckets: readonly ProfileHistogramBucket[],
  from: Date,
  to: Date,
): { from: number; to: number } | null {
  let first = -1;
  let last = -1;
  buckets.forEach((bucket, index) => {
    const overlaps =
      new Date(bucket.endTimestamp).getTime() > from.getTime() &&
      new Date(bucket.timestamp).getTime() < to.getTime();
    if (!overlaps) return;
    if (first < 0) first = index;
    last = index;
  });
  return first < 0 ? null : { from: first, to: last };
}
