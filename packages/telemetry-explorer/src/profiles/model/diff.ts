import { resolveTimeRange, type TimeRange } from "@everr/ui/lib/time-range";
import type { FlameNode, FlameTree, FunctionStat } from "./flame-tree";

/** Windows at a fixed offset from the current range. */
const PRESET_BASELINES = ["previous", "day", "week"] as const;
export type PresetBaseline = (typeof PRESET_BASELINES)[number];

/**
 * `custom` compares with a window dragged out on the histogram, `version` the
 * latest `service.version` with the one before it.
 */
export const BASELINES = [...PRESET_BASELINES, "custom", "version"] as const;
export type Baseline = (typeof BASELINES)[number];

export const BASELINE_LABELS: Record<Baseline, string> = {
  previous: "Previous period",
  day: "Same time yesterday",
  week: "Same time last week",
  custom: "Custom window",
  version: "Previous version",
};

export function isPresetBaseline(baseline: Baseline): baseline is PresetBaseline {
  return PRESET_BASELINES.some((preset) => preset === baseline);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The window the current range is compared against, as absolute times. */
export function baselineRange(
  range: TimeRange,
  baseline: PresetBaseline,
  now = new Date(),
): TimeRange {
  const { fromDate, toDate } = resolveTimeRange(range, now);
  const shift =
    baseline === "previous"
      ? toDate.getTime() - fromDate.getTime()
      : baseline === "day"
        ? DAY_MS
        : 7 * DAY_MS;
  return {
    from: new Date(fromDate.getTime() - shift).toISOString(),
    to: new Date(toDate.getTime() - shift).toISOString(),
  };
}

/**
 * A frame's weight in both windows. Shares, not raw values, are compared, so
 * a busier window does not paint every frame as a regression.
 */
export type FrameDiff = {
  baseline: number;
  comparison: number;
  /** comparison share minus baseline share, from -1 to 1. */
  delta: number;
};

/** Diffs keyed by frame id, for every frame of the comparison tree. */
export function diffFlameTrees(
  comparison: FlameTree,
  baseline: FlameTree,
): ReadonlyMap<string, FrameDiff> {
  const diffs = new Map<string, FrameDiff>();
  const comparisonTotal = comparison.root.total;
  const baselineTotal = baseline.root.total;
  const visit = (node: FlameNode, base: FlameNode | undefined) => {
    const baselineValue = base?.total ?? 0;
    diffs.set(node.id, {
      baseline: baselineValue,
      comparison: node.total,
      delta: share(node.total, comparisonTotal) - share(baselineValue, baselineTotal),
    });
    const baseChildren = new Map(base?.children.map((c) => [c.key, c]));
    for (const child of node.children) visit(child, baseChildren.get(child.key));
  };
  visit(comparison.root, baseline.root);
  return diffs;
}

export type FunctionDiff = {
  key: string;
  name: string;
  file: string;
  baselineSelf: number;
  comparisonSelf: number;
  /** Self share change, comparison minus baseline. */
  selfDelta: number;
};

/** Per-function self time in both windows, including functions only one window has. */
export function diffFunctionStats(
  comparison: readonly FunctionStat[],
  comparisonTotal: number,
  baseline: readonly FunctionStat[],
  baselineTotal: number,
): FunctionDiff[] {
  const rows = new Map<string, FunctionDiff>();
  const row = (stat: FunctionStat) => {
    let existing = rows.get(stat.key);
    if (!existing) {
      existing = {
        key: stat.key,
        name: stat.name,
        file: stat.file,
        baselineSelf: 0,
        comparisonSelf: 0,
        selfDelta: 0,
      };
      rows.set(stat.key, existing);
    }
    return existing;
  };
  for (const stat of baseline) row(stat).baselineSelf = stat.self;
  for (const stat of comparison) row(stat).comparisonSelf = stat.self;
  for (const diff of rows.values()) {
    diff.selfDelta =
      share(diff.comparisonSelf, comparisonTotal) - share(diff.baselineSelf, baselineTotal);
  }
  return [...rows.values()];
}

// Below this change in share a frame reads as unchanged.
const NEUTRAL_DELTA = 0.001;

/**
 * Red for frames that take a larger share than in the baseline, green for a
 * smaller one. Light enough for the flame graph's dark labels. `scale` is the
 * largest change on screen, so the strongest color always marks the biggest
 * change.
 */
export function diffColor(delta: number, scale: number): string {
  if (Math.abs(delta) < NEUTRAL_DELTA) return "hsl(220 10% 78%)";
  const strength = Math.min(Math.abs(delta) / Math.max(scale, NEUTRAL_DELTA), 1);
  const lightness = 88 - 30 * strength;
  return delta > 0 ? `hsl(0 80% ${lightness}%)` : `hsl(145 55% ${lightness}%)`;
}

/** Colors each frame by its diff, scaled to the largest change. */
export function diffColorOf(
  diffs: ReadonlyMap<string, FrameDiff>,
): (frame: { spanId: string }) => string | undefined {
  const scale = maxAbsDelta(diffs);
  return (frame) => {
    const diff = diffs.get(frame.spanId);
    return diff ? diffColor(diff.delta, scale) : undefined;
  };
}

function maxAbsDelta(diffs: ReadonlyMap<string, FrameDiff>): number {
  let max = 0;
  for (const [, diff] of diffs) max = Math.max(max, Math.abs(diff.delta));
  return max;
}

function share(value: number, total: number): number {
  return total > 0 ? value / total : 0;
}

/** A share change in percentage points, signed, e.g. `+12.5 pp`. */
export function formatShareDelta(delta: number): string {
  const points = delta * 100;
  if (Math.abs(points) < 0.01) return "no change";
  return `${points > 0 ? "+" : "−"}${Math.abs(points).toFixed(2)} pp`;
}
