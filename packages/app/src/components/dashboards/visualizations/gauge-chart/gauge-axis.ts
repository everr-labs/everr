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
function formatAxisValue(value: number, unit?: string): string {
  return `${formatStatValue(value, undefined)}${unit ?? ""}`;
}

/**
 * The min/max end labels: a zero end carries no unit, since "0%" and "0ms" say
 * nothing "0" does not, and the ends are the smallest type on the gauge.
 */
export function formatAxisEnd(value: number, unit?: string): string {
  return formatAxisValue(value, value === 0 ? undefined : unit);
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
  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  const marks: ThresholdMark[] = [];
  for (const step of thresholds.steps) {
    const value =
      thresholds.mode === "percent" ? (step.value / 100) * ref : step.value;
    if (value <= lower || value >= upper) continue;
    marks.push({
      fraction: axisFraction(value, min, max),
      text: formatAxisValue(value, unit),
      color: step.color,
    });
  }
  return marks.sort((a, b) => a.fraction - b.fraction);
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
  const colors: string[] = [];
  for (let i = 0; i <= marks.length; i++) {
    const from = bandStart(marks, i);
    const to = bandEnd(marks, i);
    const midValue = min + ((from + to) / 2) * (max - min);
    colors.push(resolveThresholdColor(midValue, thresholds, max) ?? fallback);
  }
  return colors;
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
  const segments: FillSegment[] = [];
  for (let i = 0; i <= marks.length; i++) {
    const from = bandStart(marks, i);
    if (from >= fraction) break;
    const to = Math.min(fraction, bandEnd(marks, i));
    // Two steps on the same value make an empty band: skip it, so the
    // segments stay unique by `from`.
    if (to > from) segments.push({ from, to, color: colors[i] ?? "" });
  }
  return segments;
}

/** Band `i` runs from the previous mark (or the min end) to the next one. */
function bandStart(marks: ThresholdMark[], i: number): number {
  return i === 0 ? 0 : (marks[i - 1]?.fraction ?? 0);
}

function bandEnd(marks: ThresholdMark[], i: number): number {
  return marks[i]?.fraction ?? 1;
}
