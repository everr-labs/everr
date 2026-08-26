import {
  detectTimeKey,
  getGroupKeys,
  getValueKeys,
  pivotByGroup,
  SERIES_COLORS,
  toNumber,
  toTimestamp,
} from "../data-utils";
import type { QueryResultRow } from "../index";

export interface TimeSeries {
  /** Opaque, sequential id (`s0`, `s1`, …) — never derived from the name, so
   * two names that would mangle to the same string can't collide. */
  key: string;
  label: string;
  color: string;
  /** One entry per timestamp in `TimeSeriesFrame.x`. `null` means this series
   * has no sample there — a gap, unless the panel connects nulls. */
  values: Array<number | null>;
}

export interface TimeSeriesFrame {
  /** The shared, ascending time axis in ms. uPlot aligns every series to one
   * x array, so a timestamp any series samples appears here once. */
  x: number[];
  series: TimeSeries[];
}

function detectInterval(timestamps: number[]): number | null {
  if (timestamps.length < 2) return null;
  const diffs: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    diffs.push(timestamps[i]! - timestamps[i - 1]!);
  }
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)]!;
}

/**
 * One series' in-domain samples, plus the timestamps where its line must break.
 *
 * Domain clamping treats each point as a BUCKET, not an instant: a bucketed
 * timestamp (e.g. ClickHouse `toStartOfInterval`) labels the bucket's start, so
 * the bucket just before `from` still covers in-range rows whenever `from`
 * isn't bucket-aligned. That point is kept when its bucket overlaps the domain;
 * it sits left of the axis and the line clips at the plot edge (Grafana-style)
 * instead of silently losing up to a bucket of data.
 *
 * Break markers are emitted when two consecutive samples of THIS series are
 * more than ~1.5× its own typical interval apart. Without them a long outage
 * between two samples would draw as one smooth curve across the whole gap,
 * since nothing else puts an x position in there. One marker sits a bucket
 * after the gap opens and another a bucket before it closes, so the curve
 * leaves and re-enters the gap at its edges rather than arcing across it —
 * a stacked panel, which reads a missing sample as a zero contribution, would
 * otherwise ramp smoothly through hours of no data.
 */
function clampSamples(
  samples: Map<number, number | null>,
  domain: [number, number],
): { points: Map<number, number | null>; breaks: number[] } {
  const sorted = [...samples.entries()].sort((a, b) => a[0] - b[0]);
  // Inferred from ALL samples, pre-clamp, so the leading bucket's width is
  // known even when only one point lands inside the domain.
  const interval = detectInterval(sorted.map(([ts]) => ts));
  const kept = sorted.filter(([ts]) => {
    if (ts > domain[1]) return false;
    if (ts >= domain[0]) return true;
    return interval !== null && ts + interval > domain[0];
  });

  const breaks: number[] = [];
  if (interval !== null) {
    for (let i = 1; i < kept.length; i++) {
      const prevTs = kept[i - 1]![0];
      const ts = kept[i]![0];
      if (ts - prevTs > interval * 1.5) {
        breaks.push(prevTs + interval, ts - interval);
      }
    }
  }

  return { points: new Map(kept), breaks };
}

/**
 * Running totals for a stacked chart, in series order.
 *
 * A null sample means "this series contributes nothing to the bucket" — it
 * counts as 0; leaving it null would break the running total for every band
 * above it.
 */
export function buildStackedValues(series: TimeSeries[]): number[][] {
  const running: number[] = [];
  return series.map((s) =>
    s.values.map((value, i) => {
      running[i] = (running[i] ?? 0) + (value ?? 0);
      return running[i]!;
    }),
  );
}

/**
 * Builds the uPlot frame by merging rows from every query result set onto a
 * single shared timeline keyed by timestamp. Rows that share a timestamp —
 * whether across different queries OR within a single query — are merged into
 * one x position, so a single set containing duplicate timestamps is collapsed
 * last-write-wins. This merge is intentional: it's how multiple queries' series
 * land on one x-axis.
 */
export function buildChartModel(
  dataSets: QueryResultRow[][],
  domain: [number, number],
): TimeSeriesFrame {
  // Per render key: its own samples (ts → value), collapsed last-write-wins on
  // duplicate timestamps. The single source of truth the frame derives from.
  const samplesByKey = new Map<string, Map<number, number | null>>();
  const metaByKey = new Map<string, { label: string; color: string }>();
  let seriesIndex = 0;

  dataSets.forEach((data) => {
    if (!data || data.length === 0) return;
    const tk = detectTimeKey(data);
    if (!tk) return;

    const groupKeys = getGroupKeys(data, [tk]);
    const rawValueKeys = getValueKeys(data, tk);

    let rows: QueryResultRow[];
    // The series' source names: pivoted group values, or raw value-column
    // names. Each is unique within its result set and is used as the
    // human-readable legend/tooltip label.
    let seriesNames: string[];

    if (groupKeys.length >= 1 && rawValueKeys.length === 1) {
      const compositeKey = "__group__";
      const keyed = data.map((row) => ({
        ...row,
        [compositeKey]: groupKeys.map((k) => row[k]).join(" · "),
      }));
      const piv = pivotByGroup(keyed, tk, compositeKey, rawValueKeys[0]!);
      rows = piv.pivoted;
      seriesNames = piv.seriesKeys;
    } else {
      rows = data;
      seriesNames = rawValueKeys;
    }

    const renderKeyByName = new Map<string, string>();
    for (const name of seriesNames) {
      const renderKey = `s${seriesIndex}`;
      renderKeyByName.set(name, renderKey);
      metaByKey.set(renderKey, {
        label: name,
        color: SERIES_COLORS[seriesIndex % SERIES_COLORS.length]!,
      });
      samplesByKey.set(renderKey, new Map());
      seriesIndex++;
    }

    for (const row of rows) {
      const ts = toTimestamp(row[tk]);
      if (ts === null) continue;
      for (const name of seriesNames) {
        // Only record a sample where this series actually has one. A pivoted
        // row carries only the groups present at its timestamp, so a missing
        // key is "not sampled here".
        if (!(name in row)) continue;
        // Coerce numeric strings (quoted ClickHouse aggregates) to numbers;
        // non-numeric values become null (a gap).
        samplesByKey
          .get(renderKeyByName.get(name)!)!
          .set(ts, toNumber(row[name]));
      }
    }
  });

  const clamped = new Map<string, Map<number, number | null>>();
  const timestamps = new Set<number>();
  for (const [key, samples] of samplesByKey) {
    const { points, breaks } = clampSamples(samples, domain);
    clamped.set(key, points);
    for (const ts of points.keys()) timestamps.add(ts);
    // A break marker is an x position no series samples, so every series is
    // null there and the line breaks — which is what a gap should look like.
    for (const ts of breaks) timestamps.add(ts);
  }

  const x = [...timestamps].sort((a, b) => a - b);
  const series: TimeSeries[] = [];
  for (const [key, points] of clamped) {
    const meta = metaByKey.get(key)!;
    series.push({
      key,
      label: meta.label,
      color: meta.color,
      values: x.map((ts) => (points.has(ts) ? points.get(ts)! : null)),
    });
  }

  return { x, series };
}
