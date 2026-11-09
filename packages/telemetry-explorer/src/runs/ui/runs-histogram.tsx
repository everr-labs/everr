import { VolumeHistogram } from "../../histogram/volume-histogram";
import type { RunHistogramBucket } from "../schemas";
import { RUN_CONCLUSION_META, RUN_HISTOGRAM_KEYS } from "./run-conclusion-meta";

export interface RunsHistogramProps {
  buckets: RunHistogramBucket[];
  isPending: boolean;
  showVolume: boolean;
  onRangeSelect: (from: Date, to: Date) => void;
  onShowVolumeChange: (show: boolean) => void;
}

const CONCLUSION_STACK = RUN_HISTOGRAM_KEYS.map((key) => ({
  key,
  label: RUN_CONCLUSION_META[key].label,
  color: RUN_CONCLUSION_META[key].chartColor,
}));

export function RunsHistogram({ buckets, ...props }: RunsHistogramProps) {
  return (
    <VolumeHistogram
      {...props}
      title="Run volume"
      emptyMessage="No runs in this range"
      buckets={buckets}
      hasData={buckets.some((bucket) => bucket.total > 0)}
      stack={CONCLUSION_STACK}
    />
  );
}
