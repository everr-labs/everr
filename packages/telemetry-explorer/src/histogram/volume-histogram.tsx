import { type ChartSeries, SeriesChart } from "@everr/ui/components/series-chart";
import { Skeleton } from "@everr/ui/components/skeleton";
import { cn } from "@everr/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import { useMemo } from "react";

interface HistogramBucket {
  timestamp: string;
  endTimestamp: string;
}

export interface VolumeStack<K extends string> {
  key: K;
  label: string;
  color: string;
}

function formatCount(value: number) {
  return value.toLocaleString();
}

function time(date: Date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Tooltip heading: date + local time range, computed from the bucket's
// timestamps so it always reflects the viewer's timezone.
function bucketTitle(bucket: HistogramBucket) {
  const start = new Date(bucket.timestamp);
  const day = start.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${day} · ${time(start)} – ${time(new Date(bucket.endTimestamp))}`;
}

/**
 * A collapsible stacked-bar histogram of volume over time, one stack segment
 * per key. Dragging across buckets selects their time range.
 */
export function VolumeHistogram<K extends string, B extends HistogramBucket & Record<K, number>>({
  title,
  emptyMessage,
  buckets,
  hasData,
  stack,
  isPending,
  showVolume,
  onRangeSelect,
  onShowVolumeChange,
  formatValue = formatCount,
  highlight,
}: {
  title: string;
  emptyMessage: string;
  buckets: B[];
  hasData: boolean;
  stack: readonly VolumeStack<K>[];
  isPending: boolean;
  showVolume: boolean;
  onRangeSelect: (from: Date, to: Date) => void;
  onShowVolumeChange: (show: boolean) => void;
  formatValue?: (value: number) => string;
  /** Bucket indexes to shade, inclusive. */
  highlight?: { from: number; to: number } | null;
}) {
  // Stable unless the formatter changes, so the chart does not rebuild per render.
  const axes = useMemo(() => ({ left: { format: formatValue, hidden: true } }), [formatValue]);
  const chart = useMemo(
    () => ({
      labels: buckets.map((bucket) => time(new Date(bucket.timestamp))),
      titles: buckets.map(bucketTitle),
      series: stack.map(({ key, label, color }): ChartSeries => ({
        id: key,
        label,
        color,
        kind: "bar",
        stack: "volume",
        values: buckets.map((bucket) => bucket[key]),
      })),
    }),
    [buckets, stack],
  );

  return (
    <section className="relative z-10 border-b bg-background">
      <button
        type="button"
        className="group flex h-9 w-full items-center px-3 text-left text-xs transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30"
        aria-expanded={showVolume}
        onClick={() => onShowVolumeChange(!showVolume)}
      >
        <span className="flex min-w-0 items-center gap-2 font-medium">
          <ChevronRight
            className={cn(
              "text-muted-foreground size-3.5 transition-transform",
              showVolume && "rotate-90",
            )}
          />
          <span>{title}</span>
        </span>
      </button>

      {showVolume ? (
        <div className="px-3 pb-2">
          {isPending ? (
            <Skeleton className="h-[104px] w-full" />
          ) : hasData ? (
            <SeriesChart
              {...chart}
              axes={axes}
              compact
              highlight={highlight}
              className="h-[104px] w-full"
              onSelect={(from, to) =>
                onRangeSelect(new Date(buckets[from].timestamp), new Date(buckets[to].endTimestamp))
              }
            />
          ) : (
            <div className="text-muted-foreground flex h-[104px] items-center justify-center rounded-md border border-dashed text-sm">
              {emptyMessage}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
