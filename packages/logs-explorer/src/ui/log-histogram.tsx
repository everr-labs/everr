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
import type { LogHistogramBucket, LogLevel } from "../schemas";
import { LOG_LEVEL_META } from "./log-level-meta";

export interface LogHistogramProps {
  buckets: LogHistogramBucket[];
  isPending: boolean;
  showVolume: boolean;
  onRangeSelect: (from: Date, to: Date) => void;
  onShowVolumeChange: (show: boolean) => void;
}

const chartConfig = {
  unknown: {
    label: LOG_LEVEL_META.unknown.label,
    color: LOG_LEVEL_META.unknown.chartColor,
  },
  trace: {
    label: LOG_LEVEL_META.trace.label,
    color: LOG_LEVEL_META.trace.chartColor,
  },
  debug: {
    label: LOG_LEVEL_META.debug.label,
    color: LOG_LEVEL_META.debug.chartColor,
  },
  info: {
    label: LOG_LEVEL_META.info.label,
    color: LOG_LEVEL_META.info.chartColor,
  },
  warning: {
    label: LOG_LEVEL_META.warning.label,
    color: LOG_LEVEL_META.warning.chartColor,
  },
  error: {
    label: LOG_LEVEL_META.error.label,
    color: LOG_LEVEL_META.error.chartColor,
  },
} satisfies ChartConfig;

const histogramStack = [
  "unknown",
  "trace",
  "debug",
  "info",
  "warning",
  "error",
] as const satisfies readonly LogLevel[];

type HistogramMouseEvent = {
  activeTooltipIndex?: number | null;
};

function histogramEventIndex(
  event: unknown,
  data: LogHistogramBucket[],
): number | null {
  const index = (event as HistogramMouseEvent | undefined)?.activeTooltipIndex;
  if (typeof index !== "number" || index < 0 || index >= data.length) {
    return null;
  }
  return index;
}

function LogHistogramChart({
  data,
  onSelectRange,
}: {
  data: LogHistogramBucket[];
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
      const startBucket = data[startIndex];
      const endBucket = data[endIndex];

      onSelectRange({
        from: startBucket.timestamp,
        to: endBucket.endTimestamp,
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
                payload?.[0]?.payload?.rangeLabel
              }
              formatter={(value, name) => (
                <>
                  <div
                    className="size-2.5 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: `var(--color-${name})` }}
                  />
                  <span className="text-muted-foreground">
                    {chartConfig[name as keyof typeof chartConfig]?.label}
                  </span>
                  <span className="ml-auto font-mono font-medium tabular-nums">
                    {(value as number).toLocaleString()}
                  </span>
                </>
              )}
            />
          }
        />
        {histogramStack.map((level) => (
          <Bar
            key={level}
            dataKey={level}
            stackId="logs"
            fill={`var(--color-${level})`}
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

export function LogHistogram({
  buckets,
  isPending,
  showVolume,
  onRangeSelect,
  onShowVolumeChange,
}: LogHistogramProps) {
  const handleSelectRange = (range: { from: string; to: string }) => {
    onRangeSelect(new Date(range.from), new Date(range.to));
  };

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
          <span>Log volume</span>
        </span>
      </button>

      {showVolume ? (
        <div className="px-3 pb-2">
          {isPending ? (
            <Skeleton className="h-[104px] w-full" />
          ) : buckets.length ? (
            <LogHistogramChart data={buckets} onSelectRange={handleSelectRange} />
          ) : (
            <div className="text-muted-foreground flex h-[104px] items-center justify-center rounded-md border border-dashed text-sm">
              No log volume in this range
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
