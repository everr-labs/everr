import {
  formatStatValue,
  resolveThresholdColor,
  type ThresholdsSpec,
} from "../stat-chart/stat-calculations";

/**
 * 0..1 position of `value` along the gauge axis, measured from the `min` end.
 * Inverted bounds (`min > max`) are supported: the signed span flips the
 * direction so the gauge fills toward the `max` end as the value approaches
 * it. Returns 0 only for a truly degenerate axis (`min === max`).
 */
export function axisFraction(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/**
 * Axis furniture (min/max ends, threshold ticks) always formats at the default
 * precision: `decimals` is the value's precision, not the axis'.
 */
export function formatAxisValue(value: number, unit?: string): string {
  return `${formatStatValue(value, undefined)}${unit ?? ""}`;
}

export interface ThresholdMark {
  fraction: number;
  /** Pre-formatted step position, for the tick label. */
  text: string;
  /** Ticks only render for steps that declare a color. */
  color?: string;
}

export interface FillSegment {
  from: number;
  to: number;
  color: string;
}

/**
 * Step positions projected onto the gauge axis, sorted along it. Percent steps
 * resolve against the same reference `resolveThresholdColor` uses
 * (thresholds.max, falling back to the gauge max), so a mark always sits where
 * the color changes. Only steps strictly inside the axis span are kept, which
 * works for inverted bounds too.
 */
export function thresholdMarks(
  thresholds: ThresholdsSpec | undefined,
  min: number,
  max: number,
  unit?: string,
): ThresholdMark[] {
  if (!thresholds?.steps) return [];
  const ref = thresholds.max ?? max;
  return thresholds.steps
    .map((step) => ({
      value:
        thresholds.mode === "percent" ? (step.value / 100) * ref : step.value,
      color: step.color,
    }))
    .filter((t) => t.value > Math.min(min, max) && t.value < Math.max(min, max))
    .map((t) => ({
      fraction: axisFraction(t.value, min, max),
      text: formatAxisValue(t.value, unit),
      color: t.color,
    }))
    .sort((a, b) => a.fraction - b.fraction);
}

/**
 * The color of each band the marks cut the track into, one entry per band
 * (`marks.length + 1`). Each band resolves from the axis value at its
 * midpoint, so inverted bounds (`min > max`) paint the bands on the correct
 * side without any ascending-axis assumption. The bands do not depend on the
 * value, so this is computed once per axis rather than per gauge.
 */
export function bandColors(
  marks: ThresholdMark[],
  thresholds: ThresholdsSpec | undefined,
  min: number,
  max: number,
  fallback: string,
): string[] {
  const bounds = axisBounds(marks);
  return bounds.slice(0, -1).map((from, i) => {
    const to = bounds[i + 1] ?? 1;
    const midValue = min + ((from + to) / 2) * (max - min);
    return resolveThresholdColor(midValue, thresholds, max) ?? fallback;
  });
}

/**
 * The filled part of the track, split at each threshold the value has crossed
 * and each piece painted with its band's color.
 */
export function fillSegments(
  fraction: number,
  marks: ThresholdMark[],
  colors: string[],
): FillSegment[] {
  const bounds = axisBounds(marks);
  const segments: FillSegment[] = [];
  bounds.slice(0, -1).forEach((from, i) => {
    const to = Math.min(fraction, bounds[i + 1] ?? 1);
    if (to > from) segments.push({ from, to, color: colors[i] ?? "" });
  });
  return segments;
}

/** Band edges along the track: the two axis ends plus every mark. */
function axisBounds(marks: ThresholdMark[]): number[] {
  return [0, ...marks.map((m) => m.fraction), 1];
}
