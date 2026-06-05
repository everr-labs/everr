export type CalculationType = "last" | "first" | "mean" | "min" | "max" | "sum";

export const CALCULATIONS: ReadonlyArray<{
  value: CalculationType;
  label: string;
}> = [
  { value: "last", label: "Last" },
  { value: "first", label: "First" },
  { value: "mean", label: "Mean" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" },
  { value: "sum", label: "Sum" },
] as const;

export function isCalculationType(value: unknown): value is CalculationType {
  return CALCULATIONS.some((c) => c.value === value);
}

export function calculate(
  values: number[],
  calculation: CalculationType,
): number | undefined {
  if (values.length === 0) return undefined;
  switch (calculation) {
    case "last":
      return values[values.length - 1];
    case "first":
      return values[0];
    case "mean":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    case "sum":
      return values.reduce((a, b) => a + b, 0);
  }
}

export interface ThresholdStep {
  value: number;
  color?: string;
}

export interface ThresholdsSpec {
  mode?: "absolute" | "percent";
  defaultColor?: string;
  steps?: ThresholdStep[];
}

export function resolveThresholdColor(
  value: number,
  thresholds: ThresholdsSpec | undefined,
  seriesMax: number,
): string | undefined {
  if (!thresholds) return undefined;
  const steps = [...(thresholds.steps ?? [])].sort((a, b) => a.value - b.value);
  const compare =
    thresholds.mode === "percent"
      ? seriesMax !== 0
        ? (value / seriesMax) * 100
        : 0
      : value;
  let color = thresholds.defaultColor;
  for (const step of steps) {
    if (compare >= step.value) color = step.color ?? color;
  }
  return color;
}

export function formatStatValue(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
