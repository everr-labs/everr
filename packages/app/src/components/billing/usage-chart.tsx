import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@everr/ui/components/chart";
import { ChartEmptyState } from "@everr/ui/components/chart-helpers";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Rectangle,
  type RectangleProps,
  XAxis,
  YAxis,
} from "recharts";
import { USAGE_METERS, type UsageMeter } from "@/lib/usage-limits";
import {
  formatUsageBytes,
  formatUsageChartDate,
  hasUsageChartData,
  isTopUsageMeter,
  type UsageChartRow,
} from "./usage-model";

const SIGNAL_CONFIG: Record<UsageMeter, { label: string; color: string }> = {
  traces: { label: "Traces", color: "hsl(217, 91%, 60%)" },
  logs: { label: "Logs", color: "hsl(25, 95%, 53%)" },
  metrics: { label: "Metrics", color: "hsl(142, 71%, 45%)" },
};

const chartConfig = Object.fromEntries(
  USAGE_METERS.map((meter) => [meter, SIGNAL_CONFIG[meter]]),
) satisfies ChartConfig;

type UsageBarShapeProps = RectangleProps & { payload?: UsageChartRow };

function UsageBarShape({
  meter,
  payload,
  ...props
}: UsageBarShapeProps & { meter: UsageMeter }) {
  const radius: RectangleProps["radius"] =
    payload && isTopUsageMeter(payload, meter) ? [4, 4, 0, 0] : 0;
  return <Rectangle {...props} radius={radius} />;
}

export function UsageChart({ rows }: { rows: UsageChartRow[] }) {
  if (!hasUsageChartData(rows)) {
    return <ChartEmptyState message="No metered usage in this period" />;
  }

  return (
    <ChartContainer
      config={chartConfig}
      className="h-72 w-full"
      aria-label="Daily telemetry usage by signal"
    >
      <BarChart
        data={rows}
        margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
        accessibilityLayer
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={28}
          tickFormatter={(date) => formatUsageChartDate(String(date))}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={64}
          tickFormatter={(value) => formatUsageBytes(Number(value))}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                const date = (payload?.[0]?.payload as { date?: string })?.date;
                return date ? formatUsageChartDate(date, true) : "";
              }}
              formatter={(value, name) => {
                const meter = String(name) as UsageMeter;
                return (
                  <>
                    <div
                      className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                      style={{
                        backgroundColor: `var(--color-${meter})`,
                      }}
                    />
                    <span className="text-muted-foreground">
                      {SIGNAL_CONFIG[meter]?.label ?? meter}
                    </span>
                    <span className="ml-auto font-mono font-medium tabular-nums">
                      {formatUsageBytes(Number(value))}
                    </span>
                  </>
                );
              }}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        {USAGE_METERS.map((meter) => (
          <Bar
            key={meter}
            dataKey={meter}
            stackId="usage"
            fill={`var(--color-${meter})`}
            shape={(props: unknown) => (
              <UsageBarShape {...(props as UsageBarShapeProps)} meter={meter} />
            )}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
