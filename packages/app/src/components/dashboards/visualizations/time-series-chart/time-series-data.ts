import type { ChartConfig } from "@everr/ui/components/chart";
import {
  detectTimeKey,
  getValueKeys,
  isNumericValue,
  toNumber,
  toTimestamp,
} from "../data-utils";
import type { QueryResultRow } from "../index";

export const TS_KEY = "__ts";

// fallow-ignore-next-line unused-export
export const COLORS = [
  "hsl(217, 91%, 60%)",
  "hsl(142, 71%, 45%)",
  "hsl(0, 84%, 60%)",
  "hsl(280, 68%, 60%)",
  "hsl(35, 92%, 50%)",
  "hsl(190, 90%, 50%)",
];

function getGroupKeys(row: QueryResultRow, timeKey: string): string[] {
  // A string that parses as a number (e.g. a quoted ClickHouse aggregate) is a
  // value, not a grouping dimension — exclude it so it isn't double-counted.
  return Object.keys(row).filter(
    (k) =>
      k !== timeKey && typeof row[k] === "string" && !isNumericValue(row[k]),
  );
}

function sanitizeKey(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "_");
}

function pivotByGroup(
  rows: QueryResultRow[],
  timeKey: string,
  groupKey: string,
  valueKey: string,
): {
  pivoted: QueryResultRow[];
  seriesKeys: string[];
  labelMap: Map<string, string>;
} {
  const byTimestamp = new Map<string | number, QueryResultRow>();
  const seriesSet = new Set<string>();
  const labelMap = new Map<string, string>();

  for (const row of rows) {
    const ts = row[timeKey];
    const group = String(row[groupKey]);
    const key = sanitizeKey(group);
    const value = toNumber(row[valueKey]);
    seriesSet.add(key);
    labelMap.set(key, group);

    let entry = byTimestamp.get(ts as string | number);
    if (!entry) {
      entry = { [timeKey]: ts };
      byTimestamp.set(ts as string | number, entry);
    }
    entry[key] = value;
  }

  const seriesKeys = [...seriesSet].sort();
  const pivoted = [...byTimestamp.values()];
  return { pivoted, seriesKeys, labelMap };
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
 * Clamp the series to the domain and break the line across real gaps, keeping
 * every in-range row at its actual timestamp. We do NOT snap rows onto an
 * epoch-aligned grid: real data offset from such a grid (raw event times, or
 * buckets aligned differently from the domain) would otherwise be dropped and
 * the chart could render blank even though rows were returned. When two
 * consecutive points are more than ~1.5× the typical interval apart, a single
 * null marker is inserted so a non-connecting line shows the gap.
 */
function fillAndClamp(
  rows: Array<Record<string, unknown>>,
  valueKeys: string[],
  domain: [number, number],
  interval: number,
): Array<Record<string, unknown>> {
  const inDomain = rows
    .filter((row) => {
      const ts = row[TS_KEY] as number;
      return ts >= domain[0] && ts <= domain[1];
    })
    .sort((a, b) => (a[TS_KEY] as number) - (b[TS_KEY] as number));

  const result: Array<Record<string, unknown>> = [];
  const gapThreshold = interval * 1.5;
  for (let i = 0; i < inDomain.length; i++) {
    const row = inDomain[i]!;
    if (i > 0) {
      const prevTs = inDomain[i - 1]![TS_KEY] as number;
      const ts = row[TS_KEY] as number;
      if (ts - prevTs > gapThreshold) {
        const empty: Record<string, unknown> = { [TS_KEY]: prevTs + interval };
        for (const k of valueKeys) {
          empty[k] = null;
        }
        result.push(empty);
      }
    }
    result.push(row);
  }
  return result;
}

export interface ChartModel {
  chartData: Array<Record<string, unknown>>;
  valueKeys: string[];
  chartConfig: ChartConfig;
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
  domain: [number, number] | undefined,
): ChartModel {
  const chartConfig: ChartConfig = {};
  const valueKeys: string[] = [];
  const byTs = new Map<number, Record<string, unknown>>();
  let colorIndex = 0;
  const multi = dataSets.length > 1;

  dataSets.forEach((data, setIndex) => {
    if (!data || data.length === 0) return;
    const tk = detectTimeKey(data);
    if (!tk) return;

    const groupKeys = getGroupKeys(data[0]!, tk);
    const rawValueKeys = getValueKeys(data[0]!, tk);

    let rows: QueryResultRow[];
    let vk: string[];
    let labels: Map<string, string> | undefined;

    if (groupKeys.length >= 1 && rawValueKeys.length === 1) {
      const compositeKey = "__group__";
      const keyed = data.map((row) => ({
        ...row,
        [compositeKey]: groupKeys.map((k) => row[k]).join(" · "),
      }));
      const piv = pivotByGroup(keyed, tk, compositeKey, rawValueKeys[0]!);
      rows = piv.pivoted;
      vk = piv.seriesKeys;
      labels = piv.labelMap;
    } else {
      rows = data;
      vk = rawValueKeys;
    }

    const prefix = multi ? `q${setIndex}__` : "";
    for (const key of vk) {
      const nsKey = `${prefix}${key}`;
      valueKeys.push(nsKey);
      chartConfig[nsKey] = {
        label: labels?.get(key) ?? key,
        color: COLORS[colorIndex % COLORS.length],
      };
      colorIndex++;
    }

    for (const row of rows) {
      const ts = toTimestamp(row[tk]);
      let entry = byTs.get(ts);
      if (!entry) {
        entry = { [TS_KEY]: ts };
        byTs.set(ts, entry);
      }
      for (const key of vk) {
        // Coerce numeric strings (quoted ClickHouse aggregates) to numbers so
        // recharts plots them; non-numeric values become null (a gap).
        entry[`${prefix}${key}`] = toNumber(row[key]);
      }
    }
  });

  const mapped = [...byTs.values()].sort(
    (a, b) => (a[TS_KEY] as number) - (b[TS_KEY] as number),
  );

  const timestamps = mapped.map((r) => r[TS_KEY] as number);
  const interval = detectInterval(timestamps);

  let filled: Array<Record<string, unknown>>;
  if (domain && interval && interval > 0) {
    filled = fillAndClamp(mapped, valueKeys, domain, interval);
  } else if (domain) {
    filled = mapped.filter((r) => {
      const ts = r[TS_KEY] as number;
      return ts >= domain[0] && ts <= domain[1];
    });
  } else {
    filled = mapped;
  }

  return { chartData: filled, valueKeys, chartConfig };
}
