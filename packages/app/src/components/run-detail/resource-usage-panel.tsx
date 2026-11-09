import { type ChartSeries, SeriesChart } from "@everr/ui/components/series-chart";
import { cn } from "@everr/ui/lib/utils";
import { useMemo } from "react";
import { niceValueAxis } from "#app/components/dashboards/visualizations/echarts/axis.ts";
import { createValueFormatter } from "#app/components/dashboards/visualizations/value-format.ts";
import type { JobResourceUsage, ResourceUsagePoint } from "#app/data/resource-usage.ts";
import { formatBytes, formatPercent, formatTimeOfDay } from "#app/lib/formatting.ts";

interface ResourceUsagePanelProps {
  data: JobResourceUsage;
  stepWindow?: { startTime: number; endTime: number } | null;
}

type RatePoint = ReturnType<typeof computeRates>[number];
type SeriesKey = keyof RatePoint & keyof typeof SERIES_META;

const SERIES_META = {
  cpuAvg: { label: "CPU Avg", color: "hsl(217, 91%, 60%)" },
  memoryUtilization: { label: "Memory", color: "hsl(262, 83%, 58%)" },
  diskRate: { label: "I/O", color: "hsl(25, 95%, 53%)" },
  networkReceiveRate: { label: "Received", color: "hsl(142, 71%, 45%)" },
  networkTransmitRate: { label: "Transmitted", color: "hsl(198, 93%, 60%)" },
};

const CPU_KEYS: SeriesKey[] = ["cpuAvg"];
const MEMORY_KEYS: SeriesKey[] = ["memoryUtilization"];
const DISK_KEYS: SeriesKey[] = ["diskRate"];
const NETWORK_KEYS: SeriesKey[] = ["networkReceiveRate", "networkTransmitRate"];
const PERCENT_AXES = {
  left: { format: formatPercent, tickFormat: (value: number) => `${value}%`, min: 0, max: 100 },
};
const SPEED = createValueFormatter({ unit: "By/s", scale: "binary" });

/** A rate axis whose ticks round in the displayed unit (2 MiB/s, not 1.9 MB/s). */
function speedAxes(max: number) {
  const { scale, format } = niceValueAxis(SPEED, 0, max, { min: 0 });
  const [min, top] = scale.domain;
  return { left: { format: SPEED.format, min, max: top, ticks: scale.ticks, tickFormat: format } };
}

function computeRates(points: ResourceUsagePoint[]) {
  return points.map((point, i) => {
    if (i === 0) {
      return {
        ...point,
        diskRate: 0,
        networkReceiveRate: 0,
        networkTransmitRate: 0,
      };
    }
    const prev = points[i - 1];
    const dtSeconds = (point.timestamp - prev.timestamp) / 1000;
    if (dtSeconds <= 0) {
      return {
        ...point,
        diskRate: 0,
        networkReceiveRate: 0,
        networkTransmitRate: 0,
      };
    }
    return {
      ...point,
      diskRate: Math.max(0, point.filesystemUsed - prev.filesystemUsed) / dtSeconds,
      networkReceiveRate: Math.max(0, point.networkReceive - prev.networkReceive) / dtSeconds,
      networkTransmitRate: Math.max(0, point.networkTransmit - prev.networkTransmit) / dtSeconds,
    };
  });
}

/**
 * The samples covering the step's window, inclusive: from the last sample at
 * or before its start to the first at or after its end, so a step shorter
 * than the sampling interval still shades the samples around it. Null when
 * the window misses the samples entirely.
 */
export function stepSampleRange(
  points: readonly ResourceUsagePoint[],
  window: { startTime: number; endTime: number },
): { from: number; to: number } | null {
  const first = points[0]?.timestamp;
  const last = points.at(-1)?.timestamp;
  if (first === undefined || last === undefined) return null;
  if (window.endTime < first || window.startTime > last) return null;
  // Samples are in time order.
  const startsBefore = points.filter((point) => point.timestamp <= window.startTime).length - 1;
  const endsAfter = points.findIndex((point) => point.timestamp >= window.endTime);
  return {
    from: Math.max(0, startsBefore),
    to: endsAfter === -1 ? points.length - 1 : endsAfter,
  };
}

function MiniChart({
  points,
  keys,
  unit,
  highlight,
}: {
  points: RatePoint[];
  keys: SeriesKey[];
  unit: "percent" | "speed";
  highlight: { from: number; to: number } | null;
}) {
  const chart = useMemo(
    () => ({
      axes:
        unit === "percent"
          ? PERCENT_AXES
          : speedAxes(Math.max(0, ...keys.flatMap((key) => points.map((point) => point[key])))),
      labels: points.map((point) => formatTimeOfDay(point.timestamp)),
      series: keys.map((key): ChartSeries => ({
        id: key,
        ...SERIES_META[key],
        kind: "area",
        values: points.map((point) => point[key]),
      })),
    }),
    [points, keys, unit],
  );
  return <SeriesChart {...chart} highlight={highlight} compact className="h-[100px] w-full" />;
}

function SummaryItem({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-[10px] uppercase tracking-wider">{label}</span>
      <span className="font-mono text-sm font-medium tabular-nums">{value}</span>
      {sub && (
        <span className="text-muted-foreground font-mono text-[10px] tabular-nums">{sub}</span>
      )}
    </div>
  );
}

export function ResourceUsagePanel({ data, stepWindow }: ResourceUsagePanelProps) {
  const { points, summary } = data;
  const ratePoints = useMemo(() => computeRates(points), [points]);
  const highlight = useMemo(
    () => (stepWindow ? stepSampleRange(points, stepWindow) : null),
    [points, stepWindow],
  );

  const hasNetwork = points.some((p) => p.networkReceive > 0 || p.networkTransmit > 0);

  if (points.length === 0) return null;

  return (
    <div className="border-b">
      {/* Summary stats */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 border-b px-3 py-2">
        <SummaryItem
          label="CPU Avg"
          value={formatPercent(summary.cpuAvg)}
          sub={`Peak ${formatPercent(summary.cpuPeak)}`}
        />
        <SummaryItem
          label="Memory Peak"
          value={formatBytes(summary.memoryPeak)}
          sub={summary.memoryLimit > 0 ? `of ${formatBytes(summary.memoryLimit)}` : undefined}
        />
        <SummaryItem
          label="Disk Peak"
          value={formatBytes(summary.filesystemPeak)}
          sub={
            summary.filesystemLimit > 0 ? `of ${formatBytes(summary.filesystemLimit)}` : undefined
          }
        />
        {hasNetwork && (
          <SummaryItem
            label="Network"
            value={`↓${formatBytes(summary.networkTotalReceive)}`}
            sub={`↑${formatBytes(summary.networkTotalTransmit)}`}
          />
        )}
      </div>

      {/* Charts grid */}
      <div
        className={cn(
          "grid gap-px bg-border",
          hasNetwork ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-3",
        )}
      >
        <ChartCard title="CPU">
          <MiniChart points={ratePoints} keys={CPU_KEYS} unit="percent" highlight={highlight} />
        </ChartCard>

        <ChartCard title="Memory">
          <MiniChart points={ratePoints} keys={MEMORY_KEYS} unit="percent" highlight={highlight} />
        </ChartCard>

        <ChartCard title="Disk">
          <MiniChart points={ratePoints} keys={DISK_KEYS} unit="speed" highlight={highlight} />
        </ChartCard>

        {hasNetwork && (
          <ChartCard title="Network">
            <MiniChart points={ratePoints} keys={NETWORK_KEYS} unit="speed" highlight={highlight} />
          </ChartCard>
        )}
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-background px-2 py-1.5">
      <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">
        {title}
      </span>
      {children}
    </div>
  );
}
