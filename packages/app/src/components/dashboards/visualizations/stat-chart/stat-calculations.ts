import type { CalculationType, ThresholdsSpec } from "./spec";

export type { CalculationType, ThresholdsSpec } from "./spec";

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
    case "count":
      return values.length;
    case "range":
      return Math.max(...values) - Math.min(...values);
    case "diff": {
      const first = values[0];
      const last = values[values.length - 1];
      return first === undefined || last === undefined
        ? undefined
        : last - first;
    }
  }
}

export interface ThresholdBand {
  color: string | undefined;
  name: string | undefined;
}

export function resolveThresholdBand(
  value: number,
  thresholds: ThresholdsSpec | undefined,
  seriesMax: number,
): ThresholdBand {
  if (!thresholds) return { color: undefined, name: undefined };
  const steps = [...(thresholds.steps ?? [])].sort((a, b) => a.value - b.value);
  // Percent mode divides by the configured max, else the series' own max. A
  // non-positive divisor would invert the comparison (e.g. an all-negative
  // series), so it degrades to "no step crossed" instead.
  const max = thresholds.max ?? seriesMax;
  const compare =
    thresholds.mode === "percent" ? (max > 0 ? (value / max) * 100 : 0) : value;
  let color = thresholds.defaultColor;
  // Unlike colors, names don't carry across an unnamed step: the crossed band
  // simply has no qualitative label.
  let name = thresholds.defaultName;
  for (const step of steps) {
    if (compare >= step.value) {
      color = step.color ?? color;
      name = step.name;
    }
  }
  return { color, name };
}

export function resolveThresholdColor(
  value: number,
  thresholds: ThresholdsSpec | undefined,
  seriesMax: number,
): string | undefined {
  return resolveThresholdBand(value, thresholds, seriesMax).color;
}

const ABBREVIATIONS: ReadonlyArray<[number, string]> = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
];

/**
 * Locale-formatted value for the stat tile. Magnitudes >= 1e6 abbreviate
 * (1234567 -> "1.23M") so large counts don't overflow the tile; thousands
 * stay exact with grouping. `decimals` fixes the fraction digits; omitted
 * means up to 2 with trailing zeros dropped.
 */
export function formatStatValue(value: number, decimals?: number): string {
  const fraction: Intl.NumberFormatOptions =
    decimals !== undefined
      ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
      : { maximumFractionDigits: 2 };
  for (const [factor, suffix] of ABBREVIATIONS) {
    if (Math.abs(value) >= factor) {
      return `${(value / factor).toLocaleString(undefined, fraction)}${suffix}`;
    }
  }
  return value.toLocaleString(undefined, fraction);
}
