import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
  maxValue?: number;
}

export function Sparkline({
  data,
  width = 120,
  height = 32,
  color = "hsl(217, 91%, 60%)",
  className,
  maxValue,
}: SparklineProps) {
  const id = useId();
  if (data.length === 0) {
    return <div style={{ width, height }} />;
  }

  const padded = data.length === 1 ? [data[0], data[0]] : data;
  const chartData = padded.map((value, index) => ({ index, value }));

  return (
    <div
      style={className ? undefined : { width, height }}
      className={className}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={chartData}
          margin={{ left: 0, right: 0, bottom: 0, top: 8 }}
        >
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.8} />
              <stop offset="95%" stopColor={color} stopOpacity={0.1} />
            </linearGradient>
          </defs>
          {maxValue != null && <YAxis domain={[0, maxValue]} hide />}
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            fill={`url(#${id})`}
            strokeWidth={1}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
