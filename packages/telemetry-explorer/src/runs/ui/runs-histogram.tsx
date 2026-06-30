import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@everr/ui/components/chart";
import { Skeleton } from "@everr/ui/components/skeleton";
import { cn } from "@everr/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, ReferenceArea, XAxis } from "recharts";
import type { RunHistogramBucket } from "../schemas";
import {
  RUN_CONCLUSION_META,
  RUN_HISTOGRAM_KEYS,
  type RunHistogramKey,
} from "./run-conclusion-meta";

export interface RunsHistogramProps {
  buckets: RunHistogramBucket[];
  isPending: boolean;
  showVolume: boolean;
  onRangeSelect: (from: Date, to: Date) => void;
  onShowVolumeChange: (show: boolean) => void;
}

const chartConfig = Object.fromEntries(
  RUN_HISTOGRAM_KEYS.map((key) => [
    key,
    {
      label: RUN_CONCLUSION_META[key].label,
      color: RUN_CONCLUSION_META[key].chartColor,
    },
  ]),
) satisfies ChartConfig;

// Tooltip heading: date + local time range, computed from the bucket's
// timestamps so it always reflects the viewer's timezone.
function formatBucketLabel(bucket: RunHistogramBucket | undefined) {
  if (!bucket) return "";
  const start = new Date(bucket.timestamp);
  const end = new Date(bucket.endTimestamp);
  const time = (date: Date) =>
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const day = start.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${day} · ${time(start)} – ${time(end)}`;
}

type HistogramMouseEvent = {
  activeTooltipIndex?: number | null;
};

function histogramEventIndex(
  event: unknown,
  data: RunHistogramBucket[],
): number | null {
  const index = (event as HistogramMouseEvent | undefined)?.activeTooltipIndex;
  if (typeof index !== "number" || index < 0 || index >= data.length) {
    return null;
  }
  return index;
}

function RunsHistogramChart({
  data,
  onSelectRange,
}: {
  data: RunHistogramBucket[];
  onSelectRange: (range: { from: string; to: string }) => void;
}) {
  const [dragRange, setDragRange] = useState<{
    startIndex: number;
    endIndex: number;
  } | null>(null);

  const activeRange = dragRange
    ? {
        startIndex: Math.min(dragRange.startIndex, dragRange.endIndex),
        endIndex: Math.max(dragRange.startIndex, dragRange.endIndex),
      }
    : null;
  const selectedStart = activeRange ? data[activeRange.startIndex] : undefined;
  const selectedEnd = activeRange ? data[activeRange.endIndex] : undefined;

  const startDrag = (event: unknown) => {
    const index = histogramEventIndex(event, data);
    if (index === null) return;
    setDragRange({ startIndex: index, endIndex: index });
  };

  const updateDrag = (event: unknown) => {
    const index = histogramEventIndex(event, data);
    if (index === null) return;
    setDragRange((currentRange) =>
      currentRange ? { ...currentRange, endIndex: index } : currentRange,
    );
  };

  const commitDrag = (event: unknown) => {
    const finalIndex = histogramEventIndex(event, data);
    const committedRange =
      dragRange && finalIndex !== null
        ? { ...dragRange, endIndex: finalIndex }
        : dragRange;

    if (committedRange) {
      const startIndex = Math.min(
        committedRange.startIndex,
        committedRange.endIndex,
      );
      const endIndex = Math.max(
        committedRange.startIndex,
        committedRange.endIndex,
      );
      onSelectRange({
        from: data[startIndex].timestamp,
        to: data[endIndex].endTimestamp,
      });
    }
    setDragRange(null);
  };

  return (
    <ChartContainer
      config={chartConfig}
      className="h-[104px] w-full select-none [&_.recharts-wrapper]:cursor-ew-resize"
      onMouseDown={(event) => event.preventDefault()}
    >
      <BarChart
        data={data}
        margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
        onMouseDown={startDrag}
        onMouseMove={updateDrag}
        onMouseUp={commitDrag}
        onMouseLeave={() => setDragRange(null)}
      >
        <XAxis
          dataKey="timestamp"
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          fontSize={10}
          interval="preserveStartEnd"
          tickFormatter={(value) =>
            new Date(value).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })
          }
        />
        <ChartTooltip
          cursor={false}
          wrapperStyle={{ zIndex: 50 }}
          content={
            <ChartTooltipContent
              className="z-50 bg-popover text-popover-foreground"
              labelFormatter={(_value, payload) =>
                formatBucketLabel(payload?.[0]?.payload)
              }
              formatter={(value, name) => (
                <>
                  <div
                    className="size-2.5 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: `var(--color-${name})` }}
                  />
                  <span className="text-muted-foreground">
                    {chartConfig[name as RunHistogramKey]?.label}
                  </span>
                  <span className="ml-auto font-mono font-medium tabular-nums">
                    {(value as number).toLocaleString()}
                  </span>
                </>
              )}
            />
          }
        />
        {RUN_HISTOGRAM_KEYS.map((key) => (
          <Bar
            key={key}
            dataKey={key}
            stackId="runs"
            fill={`var(--color-${key})`}
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
          />
        ))}
        {selectedStart && selectedEnd ? (
          <ReferenceArea
            x1={selectedStart.timestamp}
            x2={selectedEnd.timestamp}
            isFront
            fill="var(--primary)"
            fillOpacity={0.08}
            stroke="var(--primary)"
            strokeOpacity={0.35}
            strokeDasharray="3 3"
          />
        ) : null}
      </BarChart>
    </ChartContainer>
  );
}

export function RunsHistogram({
  buckets,
  isPending,
  showVolume,
  onRangeSelect,
  onShowVolumeChange,
}: RunsHistogramProps) {
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
          <span>Run volume</span>
        </span>
      </button>

      {showVolume ? (
        <div className="px-3 pb-2">
          {isPending ? (
            <Skeleton className="h-[104px] w-full" />
          ) : buckets.some((bucket) => bucket.total > 0) ? (
            <RunsHistogramChart
              data={buckets}
              onSelectRange={(range) =>
                onRangeSelect(new Date(range.from), new Date(range.to))
              }
            />
          ) : (
            <div className="text-muted-foreground flex h-[104px] items-center justify-center rounded-md border border-dashed text-sm">
              No runs in this range
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
