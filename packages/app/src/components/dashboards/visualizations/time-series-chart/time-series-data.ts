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

export const TS_KEY = "__ts";
export type SeriesPoint = [timestamp: number, value: number | null];

export interface ChartSeries {
  id: string;
  label: string;
  color: string;
  data: SeriesPoint[];
}

function detectInterval(timestamps: number[]): number | null {
  let previous = timestamps[0];
  if (previous === undefined || timestamps.length < 2) return null;
  const diffs: number[] = [];
  for (const current of timestamps.slice(1)) {
    diffs.push(current - previous);
    previous = current;
  }
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)] ?? null;
}

/** Sort the merged timeline and clamp it to the domain (no gap markers — this
 * array drives the crosshair/tooltip lookup, not the lines). */
function clampMerged(
  byTs: Map<number, Record<string, unknown>>,
  domain: [number, number],
): Array<Record<string, unknown>> {
  return [...byTs.values()]
    .filter((r) => {
      const ts = r[TS_KEY] as number;
      return ts >= domain[0] && ts <= domain[1];
    })
    .sort((a, b) => (a[TS_KEY] as number) - (b[TS_KEY] as number));
}

/**
 * Build ECharts point pairs from one line's own samples, independent of any
 * other series' timestamps. Each line is rendered with its own array so a
 * timestamp where only another series has a point is simply absent here — it
 * never becomes a hole that breaks the line. We do NOT snap onto an
 * epoch-aligned grid: every in-range point keeps its real timestamp. A single
 * null marker is inserted when two consecutive points of THIS series are more
 * than ~1.5× its own typical interval apart, so a non-connecting line shows the
 * genuine gap.
 *
 * Domain clamping treats each point as a BUCKET, not an instant: a bucketed
 * timestamp (e.g. ClickHouse `toStartOfInterval`) labels the bucket's start,
 * so the bucket just before `from` still covers in-range rows whenever `from`
 * isn't bucket-aligned. That point is kept when its bucket overlaps the
 * domain; it sits left of the axis and the line clips at the plot edge
 * (Grafana-style) instead of silently losing up to a bucket of data.
 */
function buildSeriesData(
  samples: Map<number, number | null>,
  domain: [number, number],
): SeriesPoint[] {
  const sorted = [...samples.entries()].sort((a, b) => a[0] - b[0]);
  // Inferred from ALL samples, pre-clamp, so the leading bucket's width is
  // known even when only one point lands inside the domain.
  const interval = detectInterval(sorted.map(([ts]) => ts));
  const points = sorted.filter(([ts]) => {
    if (ts > domain[1]) return false;
    if (ts >= domain[0]) return true;
    return interval !== null && ts + interval > domain[0];
  });

  const result: SeriesPoint[] = [];
  let previousTs: number | null = null;
  for (const [ts, value] of points) {
    if (previousTs !== null && interval && ts - previousTs > interval * 1.5) {
      result.push([previousTs + interval, null]);
    }
    result.push([ts, value]);
    previousTs = ts;
  }
  return result;
}

/**
 * ECharts stacks by data index, so every series needs a point at each merged
 * timestamp. A missing or null sample contributes nothing to the bucket, so
 * fill it with 0;
 * leaving it undefined would corrupt the running stack offset for the series
 * above it.
 */
export function buildStackedData(
  chartData: Array<Record<string, unknown>>,
  series: ChartSeries[],
): SeriesPoint[][] {
  return series.map(({ id }) =>
    chartData.map((row): SeriesPoint => {
      const value = row[id];
      return [row[TS_KEY] as number, typeof value === "number" ? value : 0];
    }),
  );
}

export interface ChartModel {
  /** Merged timeline (all series by timestamp) for crosshair/tooltip lookup. */
  chartData: Array<Record<string, unknown>>;
  /** Each line connects its own samples regardless of other series' timestamps. */
  series: ChartSeries[];
}

/**
 * Builds a chart model by merging rows from every query result set onto a
 * single shared timeline keyed by timestamp. Rows that share a timestamp —
 * whether across different queries OR within a single query — are merged into
 * one entry, so a single set containing duplicate timestamps is collapsed
 * last-write-wins. This merge is intentional: it's how multiple queries' series
 * land on one x-axis.
 */
export function buildChartModel(
  dataSets: QueryResultRow[][],
  domain: [number, number],
): ChartModel {
  // Per series: samples collapse duplicate timestamps with last-write-wins.
  // Both the rendered lines and merged hover timeline derive from these maps.
  const pendingSeries: Array<{
    id: string;
    label: string;
    color: string;
    samples: Map<number, number | null>;
  }> = [];
  let seriesIndex = 0;

  dataSets.forEach((data) => {
    if (!data || data.length === 0) return;
    const tk = detectTimeKey(data);
    if (!tk) return;

    const groupKeys = getGroupKeys(data, [tk]);
    const rawValueKeys = getValueKeys(data, tk);

    let rows: QueryResultRow[];
    // The series' source names: pivoted group values, or raw value-column names.
    // Each is unique within its result set and is used as the human-readable
    // legend/tooltip label.
    let seriesNames: string[];

    const groupValueKey = rawValueKeys[0];
    if (
      groupKeys.length >= 1 &&
      rawValueKeys.length === 1 &&
      groupValueKey !== undefined
    ) {
      const compositeKey = "__group__";
      const keyed = data.map((row) => ({
        ...row,
        [compositeKey]: groupKeys.map((k) => row[k]).join(" · "),
      }));
      const piv = pivotByGroup(keyed, tk, compositeKey, groupValueKey);
      rows = piv.pivoted;
      seriesNames = piv.seriesKeys;
    } else {
      rows = data;
      seriesNames = rawValueKeys;
    }

    // Opaque ids stay unique across queries even when two series share a label.
    const samplesByName = new Map<string, Map<number, number | null>>();
    for (const name of seriesNames) {
      const renderKey = `s${seriesIndex}`;
      const samples = new Map<number, number | null>();
      pendingSeries.push({
        id: renderKey,
        label: name,
        color: SERIES_COLORS[seriesIndex % SERIES_COLORS.length],
        samples,
      });
      samplesByName.set(name, samples);
      seriesIndex++;
    }

    for (const row of rows) {
      const ts = toTimestamp(row[tk]);
      if (ts === null) continue;
      for (const name of seriesNames) {
        // Only record a sample where this series actually has one. A pivoted row
        // carries only the groups present at its timestamp, so a missing key is
        // "not sampled here" — NOT a gap — and must not appear in this series'
        // data (where it would break the line).
        if (!(name in row)) continue;
        // Coerce numeric strings (quoted ClickHouse aggregates) to numbers so
        // the chart plots them; non-numeric values become null (a gap).
        samplesByName.get(name)?.set(ts, toNumber(row[name]));
      }
    }
  });

  const byTs = new Map<number, Record<string, unknown>>();
  const series = pendingSeries.map(({ samples, ...metadata }): ChartSeries => {
    for (const [ts, value] of samples) {
      let entry = byTs.get(ts);
      if (!entry) {
        entry = { [TS_KEY]: ts };
        byTs.set(ts, entry);
      }
      entry[metadata.id] = value;
    }
    return { ...metadata, data: buildSeriesData(samples, domain) };
  });

  return {
    chartData: clampMerged(byTs, domain),
    series,
  };
}
