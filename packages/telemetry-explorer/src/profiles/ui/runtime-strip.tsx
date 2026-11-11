import { type ChartSeries, SeriesChart } from "@everr/ui/components/series-chart";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ProfileFilterInput } from "../data/schemas";
import {
  GC_TYPES,
  type GcType,
  type RuntimeMetricsBucket,
  type RuntimeMetricsRepositoryLike,
  runtimeMetricsOptions,
} from "../data/runtime";
import { formatProfileValue } from "../model/format";

const GC_COLORS: Record<GcType, string> = {
  minor: "var(--color-emerald-500)",
  major: "var(--color-violet-500)",
  incremental: "var(--color-sky-500)",
  weakcb: "var(--color-green-600)",
};

const GC_LABELS: Record<GcType, string> = {
  minor: "Minor GC",
  major: "Major GC",
  incremental: "Incremental marking",
  weakcb: "Weak callbacks",
};

function formatSeconds(value: number) {
  return formatProfileValue(value, "s");
}

const AXES = { left: { format: formatSeconds, hidden: true } };

function time(date: Date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function bucketTitle(bucket: RuntimeMetricsBucket) {
  const start = new Date(bucket.timestamp);
  const day = start.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${day} · ${time(start)} – ${time(new Date(bucket.endTimestamp))}`;
}

/**
 * Node.js event-loop delay and GC time for the selected services, on the
 * samples histogram's buckets, so a blocked loop or a GC pause lines up with
 * the CPU it cost. Renders nothing when no service reports runtime metrics.
 */
export function RuntimeStrip({
  repo,
  refresh,
  filters,
  onRangeSelect,
}: {
  repo: RuntimeMetricsRepositoryLike;
  refresh: string;
  filters: ProfileFilterInput;
  onRangeSelect: (from: Date, to: Date) => void;
}) {
  const input = useMemo(
    () => ({
      timeRange: filters.timeRange,
      services: filters.services ?? [],
      attributes: (filters.attributes ?? []).filter((filter) => filter.source === "resource"),
    }),
    [filters.timeRange, filters.services, filters.attributes],
  );
  const { data } = useQuery(runtimeMetricsOptions({ repo, refresh, input }));
  const buckets = data?.buckets;

  const shared = useMemo(
    () =>
      buckets
        ? {
            labels: buckets.map((bucket) => time(new Date(bucket.timestamp))),
            titles: buckets.map(bucketTitle),
          }
        : undefined,
    [buckets],
  );
  const delaySeries = useMemo<ChartSeries[]>(
    () =>
      buckets
        ? [
            {
              id: "p99",
              label: "p99",
              color: "var(--color-amber-500)",
              kind: "bar",
              values: buckets.map((bucket) => bucket.eventLoopDelayP99),
            },
            {
              id: "max",
              label: "Max",
              color: "var(--color-red-600)",
              kind: "bar",
              values: buckets.map((bucket) => bucket.eventLoopDelayMax),
            },
          ]
        : [],
    [buckets],
  );
  const gcSeries = useMemo<ChartSeries[]>(
    () =>
      buckets
        ? GC_TYPES.filter((type) => buckets.some((bucket) => bucket.gc[type] > 0)).map((type) => ({
            id: type,
            label: GC_LABELS[type],
            color: GC_COLORS[type],
            kind: "bar",
            stack: "gc",
            values: buckets.map((bucket) => bucket.gc[type]),
          }))
        : [],
    [buckets],
  );

  if (!data || !buckets || !shared || (!data.hasEventLoopDelay && !data.hasGc)) return null;

  const select = (from: number, to: number) =>
    onRangeSelect(new Date(buckets[from].timestamp), new Date(buckets[to].endTimestamp));
  const peakP99 = Math.max(0, ...buckets.map((bucket) => bucket.eventLoopDelayP99 ?? 0));
  const peakMax = Math.max(0, ...buckets.map((bucket) => bucket.eventLoopDelayMax ?? 0));
  const gcTotal = buckets.reduce(
    (sum, bucket) => sum + GC_TYPES.reduce((typeSum, type) => typeSum + bucket.gc[type], 0),
    0,
  );

  return (
    <section
      aria-label="Node.js runtime"
      className="grid grid-cols-1 gap-x-4 gap-y-2 border-b px-3 py-2 md:grid-cols-2"
    >
      {data.hasEventLoopDelay ? (
        <RuntimeChart
          title="Event-loop delay"
          summary={`peak p99 ${formatSeconds(peakP99)}, max ${formatSeconds(peakMax)}`}
          labels={shared.labels}
          titles={shared.titles}
          series={delaySeries}
          onSelect={select}
        />
      ) : null}
      {data.hasGc ? (
        <RuntimeChart
          title="GC time"
          summary={`${formatSeconds(gcTotal)} in range`}
          labels={shared.labels}
          titles={shared.titles}
          series={gcSeries}
          onSelect={select}
        />
      ) : null}
    </section>
  );
}

function RuntimeChart({
  title,
  summary,
  labels,
  titles,
  series,
  onSelect,
}: {
  title: string;
  summary: string;
  labels: readonly string[];
  titles: readonly string[];
  series: readonly ChartSeries[];
  onSelect: (from: number, to: number) => void;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2 text-xs">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground tabular-nums">{summary}</span>
      </div>
      <SeriesChart
        labels={labels}
        titles={titles}
        series={series}
        axes={AXES}
        compact
        className="h-16 w-full"
        onSelect={onSelect}
      />
    </div>
  );
}
