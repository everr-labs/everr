/* oxlint-disable typescript/consistent-type-assertions -- Chart model timestamps are numeric; erased assertions preserve the existing arithmetic without coercing other values. */
/* oxlint-disable typescript/no-non-null-assertion -- These erased assertions describe existing trusted data and library contracts; runtime validation would change behavior. */
import {
  detectTimeKey,
  getGroupKeys,
  getValueKeys,
  pivotByGroup,
  SERIES_COLORS,
  toNumber,
  toTimestamp,
} from "../data-utils";
import type { LegendSeries } from "@everr/ui/components/series-legend";
import type { QueryResultRow } from "../index";

export const X_KEY = "__x";

export interface BarChartModel {
  /** One entry per x value (timestamp or category), merged across queries. */
  chartData: Array<Record<string, unknown>>;
  /** Series in draw order; each `id` keys its values in `chartData`. */
  series: LegendSeries[];
  /** True when every contributing frame had a time column — x values are
   * epoch ms and the axis labels format as times. */
  isTimeAxis: boolean;
}

/**
 * Builds a bar chart model by merging rows from every query result set onto a
 * single x-axis. The x column is the frame's time column when it has one
 * (detected like the time-series chart), otherwise its first non-numeric
 * string column — so the same chart covers bars-over-time and categorical
 * bars. Rows that share an x value are merged into one entry (last-write-wins
 * within a series); that merge is how multiple queries' series land on one
 * axis. Remaining string columns pivot a single value column into one series
 * per label, exactly like the time-series chart.
 *
 * A time axis is sorted ascending; categories keep first-seen (query) order.
 * `colors` pins a series to a fixed color by name; the rest cycle the palette
 * in first-seen order (a pinned series still consumes its palette slot, so
 * pinning one series never reshuffles the others).
 */
export function buildBarChartModel(
  dataSets: QueryResultRow[][],
  colors: Record<string, string> = {},
): BarChartModel {
  const series: LegendSeries[] = [];
  const byX = new Map<string | number, Record<string, unknown>>();
  let seriesIndex = 0;
  let sawTime = false;
  let sawCategory = false;

  dataSets.forEach((data, queryIndex) => {
    if (!data || data.length === 0) return;

    const timeKey = detectTimeKey(data);
    let xKey: string;
    if (timeKey) {
      xKey = timeKey;
      sawTime = true;
    } else {
      // No time column: the first string column is the category axis. A frame
      // with only numeric columns falls back to its first column so something
      // sensible still renders (e.g. numeric bucket labels).
      xKey = getGroupKeys(data, [])[0] ?? Object.keys(data[0])[0];
      sawCategory = true;
    }

    const groupKeys = getGroupKeys(data, [xKey]);
    const rawValueKeys = getValueKeys(data, xKey).filter((k) => !groupKeys.includes(k));

    let rows: QueryResultRow[];
    // The series' source names: pivoted group values, or raw value-column names.
    let seriesNames: string[];

    if (groupKeys.length >= 1 && rawValueKeys.length === 1) {
      const compositeKey = "__group__";
      const keyed = data.map((row) => ({
        ...row,
        [compositeKey]: groupKeys.map((k) => row[k]).join(" · "),
      }));
      const piv = pivotByGroup(keyed, xKey, compositeKey, rawValueKeys[0]);
      rows = piv.pivoted;
      seriesNames = piv.seriesKeys;
    } else {
      rows = data;
      seriesNames = rawValueKeys;
    }

    // Render keys are opaque, sequential ids (`s0`, `s1`, …) so they can never
    // collide with each other or with X_KEY. The original name stays as the label.
    const renderKeyByName = new Map<string, string>();
    for (const name of seriesNames) {
      const id = `s${seriesIndex}`;
      renderKeyByName.set(name, id);
      series.push({
        id,
        identity: JSON.stringify([queryIndex, name]),
        label: name,
        color: colors[name] ?? SERIES_COLORS[seriesIndex % SERIES_COLORS.length]!,
      });
      seriesIndex++;
    }

    for (const row of rows) {
      const x = timeKey ? toTimestamp(row[xKey]) : String(row[xKey] ?? "");
      if (x === null) continue;
      let entry = byX.get(x);
      if (!entry) {
        entry = { [X_KEY]: x };
        byX.set(x, entry);
      }
      for (const name of seriesNames) {
        // A pivoted row carries only the groups present at its x value, so a
        // missing key is "no bar here" — don't record it as 0.
        if (!(name in row)) continue;
        entry[renderKeyByName.get(name)!] = toNumber(row[name]);
      }
    }
  });

  const isTimeAxis = sawTime && !sawCategory;
  const chartData = [...byX.values()];
  if (isTimeAxis) {
    chartData.sort((a, b) => (a[X_KEY] as number) - (b[X_KEY] as number));
  }

  return { chartData, series, isTimeAxis };
}
