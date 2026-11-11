import { useId } from "react";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
  maxValue?: number;
}

const TOP_INSET = 8;

/**
 * A monotone cubic curve through the points (d3's curveMonotoneX): smooth,
 * but never overshooting the data, so it cannot dip below the baseline or
 * peak above the max.
 */
function monotonePath(points: readonly [number, number][]): string {
  const slopes = points.slice(1).map(([x, y], i) => (y - points[i][1]) / (x - points[i][0]));
  const interior = (before: number, after: number) =>
    before * after <= 0
      ? 0
      : Math.sign(before) *
        Math.min(2 * Math.abs(before), 2 * Math.abs(after), Math.abs(before + after) / 2);
  const tangents = points.map((_, i) =>
    i === 0 || i === points.length - 1 ? 0 : interior(slopes[i - 1], slopes[i]),
  );
  // The ends take the slope that keeps the curve's second derivative zero.
  const last = points.length - 1;
  tangents[0] = (3 * slopes[0] - tangents[1]) / 2;
  tangents[last] = (3 * slopes[last - 1] - tangents[last - 1]) / 2;
  if (points.length === 2) tangents.fill(slopes[0]);

  const [x0, y0] = points[0];
  let path = `M${x0},${y0}`;
  for (let i = 1; i < points.length; i++) {
    const [xa, ya] = points[i - 1];
    const [xb, yb] = points[i];
    const third = (xb - xa) / 3;
    path += ` C${xa + third},${ya + third * tangents[i - 1]} ${xb - third},${yb - third * tangents[i]} ${xb},${yb}`;
  }
  return path;
}

/**
 * A filled trend line with no axes, drawn as plain SVG that stretches to its
 * box. The y-scale runs from 0 to `maxValue` (default: the data's max).
 */
export function Sparkline({
  data,
  width = 120,
  height = 32,
  color = "hsl(217, 91%, 60%)",
  className,
  maxValue,
}: SparklineProps) {
  const id = useId();
  const box = className ? undefined : { width, height };
  if (data.length === 0) return <div style={box} />;

  const values = data.length === 1 ? [data[0], data[0]] : data;
  const max = maxValue ?? Math.max(...values);
  const x = (index: number) => (index / (values.length - 1)) * 100;
  const y = (value: number) =>
    max > 0 ? TOP_INSET + (1 - Math.min(value, max) / max) * (100 - TOP_INSET) : 100;
  const line = monotonePath(values.map((value, index): [number, number] => [x(index), y(value)]));

  return (
    <div style={box} className={className}>
      <svg
        className="block h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.8} />
            <stop offset="95%" stopColor={color} stopOpacity={0.1} />
          </linearGradient>
        </defs>
        <path d={`${line} L100,100 L0,100 Z`} fill={`url(#${id})`} />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
