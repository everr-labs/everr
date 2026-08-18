import {
  formatStatValue,
  resolveThresholdColor,
  type ThresholdsSpec,
} from "../stat-chart/stat-calculations";

/**
 * Calculates the position of `value` on the gauge axis, from 0 to 1. The
 * position 0 is the `min` end. If the bounds are inverted (`min > max`), the
 * direction of the axis changes. The gauge then fills to the `max` end when
 * the value moves to `max`. If `min` is equal to `max`, the result is 0.
 */
export function axisFraction(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/**
 * Formats a value on the axis: the min and max ends, and the threshold ticks.
 * The axis always uses the default precision. The `decimals` option applies
 * to the gauge value only.
 */
function formatAxisValue(value: number, unit?: string): string {
  return `${formatStatValue(value, undefined)}${unit ?? ""}`;
}

/**
 * Formats one end of the axis. If the end value is 0, the label does not show
 * the unit, because "0" is clear without it. The end labels are also the
 * smallest text on the gauge.
 */
export function formatAxisEnd(value: number, unit?: string): string {
  return formatAxisValue(value, value === 0 ? undefined : unit);
}

export interface ThresholdMark {
  fraction: number;
  /** The position of the step as text, for the tick label. */
  text: string;
  /** A tick shows only if its step has a color. */
  color?: string;
}

export interface FillSegment {
  from: number;
  to: number;
  color: string;
}

/**
 * Calculates the position of each threshold step on the gauge axis, in the
 * sequence of the axis. For `percent` steps, this function uses the same
 * reference as `resolveThresholdColor`: `thresholds.max`, or the gauge `max`
 * if `thresholds.max` is not set. Each mark is thus at the position where the
 * color changes. The function keeps only the steps that are inside the span
 * of the axis. This is also correct if the bounds are inverted.
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
 * Gives the color of each band between the marks. There is one color for each
 * band (`marks.length + 1`). Each band gets its color from the axis value at
 * the center of the band. The colors stay on the correct side if the bounds
 * are inverted (`min > max`), because this function does not assume that the
 * axis increases. The bands do not change with the gauge value. This function
 * thus runs one time for each axis, and not one time for each gauge.
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
 * Gives the filled part of the track. The function divides the filled part at
 * each threshold that the value passes. Each part has the color of its band.
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
    // Two steps with the same value make an empty band. The loop does not
    // add it, because each segment must have a different `from` value.
    if (to > from) segments.push({ from, to, color: colors[i] ?? "" });
  }
  return segments;
}

/** Band `i` starts at the mark before it, or at the `min` end. */
function bandStart(marks: ThresholdMark[], i: number): number {
  return i === 0 ? 0 : (marks[i - 1]?.fraction ?? 0);
}

function bandEnd(marks: ThresholdMark[], i: number): number {
  return marks[i]?.fraction ?? 1;
}
