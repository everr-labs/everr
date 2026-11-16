import { VolumeHistogram } from "../../histogram/volume-histogram";
import type { LogHistogramBucket, LogLevel } from "../schemas";
import { LOG_LEVEL_META } from "./log-level-meta";

export interface LogHistogramProps {
  buckets: LogHistogramBucket[];
  isPending: boolean;
  showVolume: boolean;
  onRangeSelect: (from: Date, to: Date) => void;
  onShowVolumeChange: (show: boolean) => void;
}

// Bottom to top: the most severe levels sit on top of each bar.
const LEVEL_STACK = (["unknown", "trace", "debug", "info", "warning", "error"] as const).map(
  (key: LogLevel) => ({
    key,
    label: LOG_LEVEL_META[key].label,
    color: LOG_LEVEL_META[key].chartColor,
  }),
);

export function LogHistogram({ buckets, ...props }: LogHistogramProps) {
  return (
    <VolumeHistogram
      {...props}
      title="Log volume"
      buckets={buckets}
      hasData={buckets.some((bucket) => bucket.total > 0)}
      stack={LEVEL_STACK}
    />
  );
}
