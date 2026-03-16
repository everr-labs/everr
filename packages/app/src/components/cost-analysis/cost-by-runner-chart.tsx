import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { ChartEmptyState } from "@/components/ui/chart-helpers";
import type { CostByRunner } from "@/data/cost-analysis/schemas";
import { formatCost } from "@/lib/runner-pricing";

interface CostByRunnerChartProps {
  data: CostByRunner[];
}

const chartConfig = {
  estimatedCost: {
    label: "Estimated Cost",
  },
} satisfies ChartConfig;

function getOsColor(os: string, isSelfHosted: boolean): string {
  if (isSelfHosted) return "hsl(0, 0%, 60%)";
  switch (os) {
    case "linux":
      return "hsl(217, 91%, 60%)";
    case "windows":
      return "hsl(263, 70%, 50%)";
    case "macos":
      return "hsl(25, 95%, 53%)";
    default:
      return "hsl(0, 0%, 60%)";
  }
}

export function CostByRunnerChart({ data }: CostByRunnerChartProps) {
  if (data.length === 0) {
    return <ChartEmptyState message="No runner data available" />;
  }

  const chartData = data.slice(0, 15);

  return (
    <ChartContainer config={chartConfig} className="h-[300px] w-full">
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ left: 12, right: 12 }}
      >
        <CartesianGrid horizontal={false} />
        <XAxis
          type="number"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(v) => formatCost(v)}
        />
        <YAxis
          type="category"
          dataKey="labels"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={120}
          tick={{ fontSize: 11 }}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelKey="labels"
              formatter={(value, _name, item) => {
                const runner = item.payload as CostByRunner;
                return (
                  <>
                    <div
                      className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                      style={{
                        backgroundColor: getOsColor(
                          runner.os,
                          runner.isSelfHosted,
                        ),
                      }}
                    />
                    <span className="text-muted-foreground">{runner.tier}</span>
                    <span className="font-mono font-medium tabular-nums ml-auto">
                      {formatCost(value as number)} ({runner.totalJobs} jobs)
                    </span>
                  </>
                );
              }}
            />
          }
        />
        <Bar
          dataKey="estimatedCost"
          radius={[0, 4, 4, 0]}
          isAnimationActive={false}
        >
          {chartData.map((entry) => (
            <Cell
              key={entry.labels}
              fill={getOsColor(entry.os, entry.isSelfHosted)}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
