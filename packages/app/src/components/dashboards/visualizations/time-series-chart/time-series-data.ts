import type { ChartConfig } from "@everr/ui/components/chart";
import {
  detectTimeKey,
  getValueKeys,
  isNumericValue,
  SERIES_COLORS,
  toNumber,
  toTimestamp,
} from "../data-utils";
import type { QueryResultRow } from "../index";

export const TS_KEY = "__ts";

function getGroupKeys(rows: QueryResultRow[], timeKey: string): string[] {
  const first = rows[0];
  if (!first) return [];
  // A column is a grouping dimension if it carries non-numeric string content in
  // *any* row. A string that parses as a number (e.g. a quoted ClickHouse
  // aggregate) is a value, not a dimension — exclude it so it isn't
  // double-counted. Scanning all rows mirrors getValueKeys: the leading bucket
  // may be NULL for a dimension that is populated later.
  return Object.keys(first).filter(
    (k) =>
      k !== timeKey &&
      rows.some((row) => typeof row[k] === "string" && !isNumericValue(row[k])),
  );
}

function pivotByGroup(
  rows: QueryResultRow[],
  timeKey: string,
  groupKey: string,
  valueKey: string,
): {
  pivoted: QueryResultRow[];
  seriesKeys: string[];
} {
  const byTimestamp = new Map<string | number, QueryResultRow>();
  const seriesSet = new Set<string>();

  for (const row of rows) {
    const ts = row[timeKey];
    // The raw group value is the series identifier — keep it intact (it's the
    // label, and uniqueness comes from the Set, not from mangling the name).
    const group = String(row[groupKey]);
    const value = toNumber(row[valueKey]);
    seriesSet.add(group);

    let entry = byTimestamp.get(ts as string | number);
    if (!entry) {
      entry = { [timeKey]: ts };
      byTimestamp.set(ts as string | number, entry);
    }
    entry[group] = value;
  }

  const seriesKeys = [...seriesSet].sort();
  const pivoted = [...byTimestamp.values()];
  return { pivoted, seriesKeys };
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

/** Sort the merged timeline and clamp it to the domain (no gap markers — this
 * array drives the x-axis and the crosshair/tooltip lookup, not the lines). */
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
 * Build one line's data from its OWN samples (ts → value), independent of any
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
  renderKey: string,
  domain: [number, number],
): Array<Record<string, unknown>> {
  const sorted = [...samples.entries()].sort((a, b) => a[0] - b[0]);
  // Inferred from ALL samples, pre-clamp, so the leading bucket's width is
  // known even when only one point lands inside the domain.
  const interval = detectInterval(sorted.map(([ts]) => ts));
  const points = sorted.filter(([ts]) => {
    if (ts > domain[1]) return false;
    if (ts >= domain[0]) return true;
    return interval !== null && ts + interval > domain[0];
  });

  const gapThreshold = interval ? interval * 1.5 : null;

  const result: Array<Record<string, unknown>> = [];
  for (let i = 0; i < points.length; i++) {
    const [ts, value] = points[i]!;
    if (i > 0 && interval && gapThreshold) {
      const prevTs = points[i - 1]![0];
      if (ts - prevTs > gapThreshold) {
        result.push({ [TS_KEY]: prevTs + interval, [renderKey]: null });
      }
    }
    result.push({ [TS_KEY]: ts, [renderKey]: value });
  }
  return result;
}

/**
 * Stacking renders every series from ONE shared array (recharts accumulates
 * `stackId` series row-by-row across the chart-level data), so each merged
 * timestamp must carry a number for every series. A missing or null sample
 * means "this series contributes nothing to the bucket" — fill it with 0;
 * leaving it undefined would corrupt the running stack offset for the series
 * above it.
 */
export function buildStackedData(
  chartData: Array<Record<string, unknown>>,
  valueKeys: string[],
): Array<Record<string, unknown>> {
  return chartData.map((row) => {
    const filled: Record<string, unknown> = { [TS_KEY]: row[TS_KEY] };
    for (const key of valueKeys) {
      const value = row[key];
      filled[key] = typeof value === "number" ? value : 0;
    }
    return filled;
  });
}

export interface ChartModel {
  /** Merged timeline (all series by timestamp). Drives the x-axis domain and
   * the crosshair/tooltip lookup — NOT the lines. */
  chartData: Array<Record<string, unknown>>;
  valueKeys: string[];
  chartConfig: ChartConfig;
  /** Per-series data arrays, keyed by render key. Each `<Line>` renders from its
   * own array so it connects its own points regardless of other series. */
  seriesData: Record<string, Array<Record<string, unknown>>>;
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
  const chartConfig: ChartConfig = {};
  const valueKeys: string[] = [];
  // Per render key: its own samples (ts → value), collapsed last-write-wins on
  // duplicate timestamps. The single source of truth — both the per-series
  // line data and the merged timeline derive from it.
  const samplesByKey = new Map<string, Map<number, number | null>>();
  let seriesIndex = 0;

  dataSets.forEach((data) => {
    if (!data || data.length === 0) return;
    const tk = detectTimeKey(data);
    if (!tk) return;

    const groupKeys = getGroupKeys(data, tk);
    const rawValueKeys = getValueKeys(data, tk);

    let rows: QueryResultRow[];
    // The series' source names: pivoted group values, or raw value-column names.
    // Each is unique within its result set and is used as the human-readable
    // legend/tooltip label.
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

    // Render keys are opaque, sequential ids (`s0`, `s1`, …) — never derived
    // from the name. This guarantees a unique, valid CSS-var/dataKey identifier
    // per series, so distinct names that would mangle to the same string (e.g.
    // `a-b` and `a b`) can't collide and overwrite each other. The original name
    // stays as the label.
    const renderKeyByName = new Map<string, string>();
    for (const name of seriesNames) {
      const renderKey = `s${seriesIndex}`;
      renderKeyByName.set(name, renderKey);
      valueKeys.push(renderKey);
      chartConfig[renderKey] = {
        label: name,
        color: SERIES_COLORS[seriesIndex % SERIES_COLORS.length],
      };
      samplesByKey.set(renderKey, new Map());
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
        // recharts plots them; non-numeric values become null (a gap).
        samplesByKey
          .get(renderKeyByName.get(name)!)!
          .set(ts, toNumber(row[name]));
      }
    }
  });

  const byTs = new Map<number, Record<string, unknown>>();
  const seriesData: Record<string, Array<Record<string, unknown>>> = {};
  for (const [key, samples] of samplesByKey) {
    for (const [ts, value] of samples) {
      let entry = byTs.get(ts);
      if (!entry) {
        entry = { [TS_KEY]: ts };
        byTs.set(ts, entry);
      }
      entry[key] = value;
    }
    seriesData[key] = buildSeriesData(samples, key, domain);
  }

  return {
    chartData: clampMerged(byTs, domain),
    valueKeys,
    chartConfig,
    seriesData,
  };
}
