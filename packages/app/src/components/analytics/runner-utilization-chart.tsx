import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { RunnerUtilization } from "@/data/analytics";

interface RunnerUtilizationChartProps {
  data: RunnerUtilization[];
}

const chartConfig = {
  totalJobs: {
    label: "Jobs",
    color: "hsl(142, 71%, 45%)",
  },
} satisfies ChartConfig;

function getColor(successRate: number): string {
  if (successRate >= 90) return "hsl(142, 71%, 45%)";
  if (successRate >= 70) return "hsl(38, 92%, 50%)";
  return "hsl(0, 84%, 60%)";
}

export function RunnerUtilizationChart({ data }: RunnerUtilizationChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-muted-foreground text-sm">
        No runner data available
      </div>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="h-[300px] w-full">
      <BarChart data={data} layout="vertical" margin={{ left: 12, right: 12 }}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis
          type="category"
          dataKey="labels"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={100}
          tick={{ fontSize: 11 }}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelKey="labels"
              formatter={(value, _name, item) => {
                const runner = item.payload as RunnerUtilization;
                return (
                  <>
                    <div
                      className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                      style={{
                        backgroundColor: getColor(runner.successRate),
                      }}
                    />
                    <span className="text-muted-foreground">Jobs</span>
                    <span className="font-mono font-medium tabular-nums ml-auto">
                      {value} ({runner.successRate}% success)
                    </span>
                  </>
                );
              }}
            />
          }
        />
        <Bar
          dataKey="totalJobs"
          radius={[0, 4, 4, 0]}
          isAnimationActive={false}
        >
          {data.map((entry) => (
            <Cell key={entry.labels} fill={getColor(entry.successRate)} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
