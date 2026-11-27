import { formatClock, formatDay } from "@everr/ui/lib/timestamp";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@everr/ui/components/collapsible";
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

// Tooltip heading: date + local time range, computed from the bucket's
// timestamps so it always reflects the viewer's timezone.
export function bucketTitle(bucket: HistogramBucket) {
  const start = new Date(bucket.timestamp);
  const end = new Date(bucket.endTimestamp);
  return `${formatDay(start, "never")} · ${formatClock(start, "minute")} – ${formatClock(end, "minute")}`;
}

// Tick spacings, in minutes: the first that puts at most MAX_TICKS on the
// axis wins. Past a week, whole weeks.
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 10_080];
const MAX_TICKS = 8;

const minutesOfLocal = (ms: number) =>
  Math.floor((ms - new Date(ms).getTimezoneOffset() * 60_000) / 60_000);

/**
 * Axis labels on round local times: a tick on each bucket where a new step
 * (an hour, 6 hours, a day) begins, and "" elsewhere. A tick at midnight
 * names the day, so a multi-day range reads "Nov 10 · 12:00 · Nov 11".
 */
export function axisLabels(buckets: readonly HistogramBucket[]): string[] {
  const first = buckets[0];
  const last = buckets.at(-1);
  if (!first || !last) return [];
  const span = (Date.parse(last.endTimestamp) - Date.parse(first.timestamp)) / 60_000;
  const step =
    TICK_STEPS.find((s) => span / s <= MAX_TICKS) ?? Math.ceil(span / MAX_TICKS / 10_080) * 10_080;
  let previous: number | null = null;
  return buckets.map((bucket) => {
    const start = Date.parse(bucket.timestamp);
    const minutes = minutesOfLocal(start);
    const period = Math.floor(minutes / step);
    const isTick = previous === null ? minutes % step === 0 : period !== previous;
    previous = period;
    if (!isTick) return "";
    // The round time the tick stands for: the bucket's start, or just before.
    const at = new Date(start - (minutes - period * step) * 60_000);
    return at.getHours() === 0 && at.getMinutes() === 0
      ? formatDay(at, "never")
      : formatClock(at, "minute");
  });
}

/**
 * A collapsible stacked-bar histogram of volume over time, one stack segment
 * per key. Dragging across buckets selects their time range.
 */
export function VolumeHistogram<K extends string, B extends HistogramBucket & Record<K, number>>({
  title,
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
      labels: axisLabels(buckets),
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
    <Collapsible
      render={<section />}
      open={showVolume}
      onOpenChange={onShowVolumeChange}
      className="relative z-10 border-b bg-background"
    >
      <CollapsibleTrigger className="group flex h-9 w-full items-center px-3 text-left text-xs transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30">
        <span className="flex min-w-0 items-center gap-2 font-medium">
          <ChevronRight
            className={cn(
              "text-muted-foreground size-3.5 transition-transform duration-200 ease-out",
              showVolume && "rotate-90",
            )}
          />
          <span>{title}</span>
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="px-3 pb-2">
          {isPending ? (
            <Skeleton className="h-[104px] w-full" />
          ) : hasData ? (
            <SeriesChart
              {...chart}
              axes={axes}
              compact
              sparseLabels
              highlight={highlight}
              className="h-[104px] w-full"
              onSelect={(from, to) =>
                onRangeSelect(new Date(buckets[from].timestamp), new Date(buckets[to].endTimestamp))
              }
            />
          ) : (
            // Short: the list below says why nothing matched, and what to try.
            <div className="text-muted-foreground flex h-[104px] items-center justify-center rounded-md border border-dashed text-xs">
              Nothing to chart
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
