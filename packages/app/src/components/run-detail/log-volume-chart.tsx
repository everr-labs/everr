import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@everr/ui/components/chart";
import { Bar, BarChart, XAxis } from "recharts";
import type { LogVolumeBin } from "@/lib/log-volume";

interface LogVolumeChartProps {
  data: LogVolumeBin[];
  onBarClick?: (firstLineIndex: number) => void;
}

const chartConfig = {
  error: { label: "Error", color: "hsl(0, 84%, 60%)" },
  warning: { label: "Warning", color: "hsl(45, 93%, 47%)" },
  notice: { label: "Notice", color: "hsl(217, 91%, 60%)" },
  debug: { label: "Debug", color: "hsl(215, 14%, 55%)" },
  command: { label: "Command", color: "hsl(187, 85%, 43%)" },
  info: { label: "Info", color: "hsl(215, 14%, 70%)" },
} satisfies ChartConfig;

// Stack order: info (bottom) → command → debug → notice → warning → error (top)
const stackOrder = [
  "info",
  "command",
  "debug",
  "notice",
  "warning",
  "error",
] as const;

export function LogVolumeChart({ data, onBarClick }: LogVolumeChartProps) {
  if (data.length === 0) return null;

  return (
    <ChartContainer config={chartConfig} className="h-[120px] w-full">
      <BarChart
        data={data}
        margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
        onClick={(state) => {
          if (state?.activeTooltipIndex != null && onBarClick) {
            const bin = data[Number(state.activeTooltipIndex)];
            if (bin) {
              onBarClick(bin.firstLineIndex);
            }
          }
        }}
      >
        <XAxis
          dataKey="timeLabel"
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          fontSize={10}
          interval="preserveStartEnd"
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelKey="timeLabel"
              formatter={(value, name) => (
                <>
                  <div
                    className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                    style={{
                      backgroundColor: `var(--color-${name})`,
                    }}
                  />
                  <span className="text-muted-foreground">
                    {chartConfig[name as keyof typeof chartConfig]?.label}
                  </span>
                  <span className="ml-auto font-mono font-medium tabular-nums">
                    {(value as number) ?? 0}
                  </span>
                </>
              )}
            />
          }
        />
        {stackOrder.map((key) => (
          <Bar
            key={key}
            dataKey={key}
            stackId="logs"
            fill={`var(--color-${key})`}
            radius={[2, 2, 0, 0]}
            cursor="pointer"
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
