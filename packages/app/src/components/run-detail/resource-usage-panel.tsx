import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  XAxis,
  YAxis,
} from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type {
  JobResourceUsage,
  ResourceUsagePoint,
} from "@/data/resource-usage";
import {
  formatBytes,
  formatPercent,
  formatSpeed,
  formatTimeOfDay,
} from "@/lib/formatting";
import { cn } from "@/lib/utils";

interface ResourceUsagePanelProps {
  data: JobResourceUsage;
  stepWindow?: { startTime: number; endTime: number } | null;
}

const cpuConfig = {
  cpuAvg: { label: "CPU Avg", color: "hsl(217, 91%, 60%)" },
  cpuMax: { label: "CPU Max", color: "hsl(217, 91%, 60%)" },
} satisfies ChartConfig;

const memoryConfig = {
  memoryUtilization: { label: "Memory", color: "hsl(262, 83%, 58%)" },
} satisfies ChartConfig;

const diskConfig = {
  diskRate: { label: "I/O", color: "hsl(25, 95%, 53%)" },
} satisfies ChartConfig;

const networkConfig = {
  networkReceiveRate: { label: "Received", color: "hsl(142, 71%, 45%)" },
  networkTransmitRate: { label: "Transmitted", color: "hsl(198, 93%, 60%)" },
} satisfies ChartConfig;

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
      diskRate:
        Math.max(0, point.filesystemUsed - prev.filesystemUsed) / dtSeconds,
      networkReceiveRate:
        Math.max(0, point.networkReceive - prev.networkReceive) / dtSeconds,
      networkTransmitRate:
        Math.max(0, point.networkTransmit - prev.networkTransmit) / dtSeconds,
    };
  });
}

function clampToRange(
  value: number,
  rangeStart: number,
  rangeEnd: number,
): number {
  return Math.max(rangeStart, Math.min(rangeEnd, value));
}

// Recharts only handles recognized chart primitives as direct AreaChart children.
// Returning ReferenceArea from a helper keeps the overlay renderable; wrapping it in
// a custom component here would be ignored by the chart.
function renderStepHighlight({
  stepWindow,
  chartStart,
  chartEnd,
}: {
  stepWindow: { startTime: number; endTime: number };
  chartStart: number;
  chartEnd: number;
}) {
  const x1 = clampToRange(stepWindow.startTime, chartStart, chartEnd);
  const x2 = clampToRange(stepWindow.endTime, chartStart, chartEnd);

  if (x1 >= x2) return null;

  return (
    <ReferenceArea
      x1={x1}
      x2={x2}
      isFront
      fill="hsl(217, 91%, 60%)"
      fillOpacity={0.08}
      stroke="hsl(217, 91%, 60%)"
      strokeOpacity={0.3}
      strokeDasharray="3 3"
    />
  );
}

function MiniChart({
  points,
  dataKeys,
  config,
  yDomain,
  yFormatter,
  tooltipFormatter,
  stepWindow,
}: {
  points: ResourceUsagePoint[];
  dataKeys: string[];
  config: ChartConfig;
  yDomain?: [number, number];
  yFormatter: (v: number) => string;
  tooltipFormatter: (v: number, name: string) => string;
  stepWindow?: { startTime: number; endTime: number } | null;
}) {
  const gradientId = useId();
  const chartStart = points[0]?.timestamp ?? 0;
  const chartEnd = points[points.length - 1]?.timestamp ?? 0;

  return (
    <ChartContainer config={config} className="h-[100px] w-full">
      <AreaChart
        data={points}
        margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
      >
        <defs>
          {dataKeys.map((key) => (
            <linearGradient
              key={key}
              id={`${gradientId}-${key}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="5%"
                stopColor={`var(--color-${key})`}
                stopOpacity={0.3}
              />
              <stop
                offset="95%"
                stopColor={`var(--color-${key})`}
                stopOpacity={0.05}
              />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="timestamp"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={formatTimeOfDay}
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          fontSize={9}
          minTickGap={40}
        />
        <YAxis
          domain={yDomain}
          tickFormatter={yFormatter}
          tickLine={false}
          axisLine={false}
          fontSize={9}
          width={40}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                const ts = payload?.[0]?.payload?.timestamp;
                return ts ? formatTimeOfDay(ts) : "";
              }}
              formatter={(value, name) => (
                <>
                  <div
                    className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: `var(--color-${name})` }}
                  />
                  <span className="text-muted-foreground">
                    {config[String(name)]?.label}
                  </span>
                  <span className="ml-auto font-mono font-medium tabular-nums">
                    {tooltipFormatter(value as number, String(name))}
                  </span>
                </>
              )}
            />
          }
        />
        {dataKeys.map((key, i) => (
          <Area
            key={key}
            type="monotone"
            dataKey={key}
            stroke={`var(--color-${key})`}
            fill={`url(#${gradientId}-${key})`}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            fillOpacity={i === 0 ? 1 : 0.5}
          />
        ))}
        {stepWindow
          ? renderStepHighlight({
              stepWindow,
              chartStart,
              chartEnd,
            })
          : null}
      </AreaChart>
    </ChartContainer>
  );
}

function SummaryItem({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-[10px] uppercase tracking-wider">
        {label}
      </span>
      <span className="font-mono text-sm font-medium tabular-nums">
        {value}
      </span>
      {sub && (
        <span className="text-muted-foreground font-mono text-[10px] tabular-nums">
          {sub}
        </span>
      )}
    </div>
  );
}

export function ResourceUsagePanel({
  data,
  stepWindow,
}: ResourceUsagePanelProps) {
  const { points, summary } = data;
  const ratePoints = computeRates(points);

  const hasNetwork = points.some(
    (p) => p.networkReceive > 0 || p.networkTransmit > 0,
  );

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
          sub={
            summary.memoryLimit > 0
              ? `of ${formatBytes(summary.memoryLimit)}`
              : undefined
          }
        />
        <SummaryItem
          label="Disk Peak"
          value={formatBytes(summary.filesystemPeak)}
          sub={
            summary.filesystemLimit > 0
              ? `of ${formatBytes(summary.filesystemLimit)}`
              : undefined
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
          <MiniChart
            points={points}
            dataKeys={["cpuAvg"]}
            config={cpuConfig}
            yDomain={[0, 100]}
            yFormatter={(v) => `${v}%`}
            tooltipFormatter={(v) => formatPercent(v)}
            stepWindow={stepWindow}
          />
        </ChartCard>

        <ChartCard title="Memory">
          <MiniChart
            points={points}
            dataKeys={["memoryUtilization"]}
            config={memoryConfig}
            yDomain={[0, 100]}
            yFormatter={(v) => `${v}%`}
            tooltipFormatter={(v) => formatPercent(v)}
            stepWindow={stepWindow}
          />
        </ChartCard>

        <ChartCard title="Disk">
          <MiniChart
            points={ratePoints}
            dataKeys={["diskRate"]}
            config={diskConfig}
            yFormatter={(v) => formatSpeed(v)}
            tooltipFormatter={(v) => formatSpeed(v)}
            stepWindow={stepWindow}
          />
        </ChartCard>

        {hasNetwork && (
          <ChartCard title="Network">
            <MiniChart
              points={ratePoints}
              dataKeys={["networkReceiveRate", "networkTransmitRate"]}
              config={networkConfig}
              yFormatter={(v) => formatSpeed(v)}
              tooltipFormatter={(v) => formatSpeed(v)}
              stepWindow={stepWindow}
            />
          </ChartCard>
        )}
      </div>
    </div>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-background px-2 py-1.5">
      <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">
        {title}
      </span>
      {children}
    </div>
  );
}
