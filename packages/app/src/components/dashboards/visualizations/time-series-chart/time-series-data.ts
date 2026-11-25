import {
  detectTimeKey,
  getGroupKeys,
  getValueKeys,
  SERIES_COLORS,
  toNumber,
  toTimestamp,
} from "../data-utils";
import type { QueryResultRow } from "../index";

export interface ChartSeries {
  id: string;
  /** Stable within a query even when refreshed rows change series order. */
  identity: string;
  label: string;
  color: string;
  /**
   * When each of this line's points is: its own samples, ascending and
   * distinct, whatever the other series' timestamps. A timestamp where only
   * another series has a point is simply absent, so it never becomes a hole
   * that breaks the line. Nothing is snapped onto a grid: every point keeps
   * its real timestamp.
   */
  times: Float64Array;
  /**
   * The value at each of `times`. NaN where there is no number: a sample that
   * was not numeric, or the marker put where two samples are more than about
   * 1.5 times the line's usual interval apart, so a line that does not connect
   * nulls shows the genuine gap.
   */
  values: Float64Array;
}

export interface ChartModel {
  /** Every sample time inside the domain, of any series, ascending and
   * distinct: what the crosshair and the tooltip snap to. */
  times: Float64Array;
  /** Each line connects its own samples regardless of other series' timestamps. */
  series: ChartSeries[];
  /** The time range the timeline and the lines are clamped to. */
  domain: readonly [from: number, to: number];
}

/** One series as its rows arrive: in any order, a time possibly seen twice. */
interface Samples {
  times: number[];
  /** NaN for a sample that is not a number. */
  values: number[];
  /** No time so far at or before the one ahead of it. */
  ascending: boolean;
}

function emptySamples(): Samples {
  return { times: [], values: [], ascending: true };
}

function addSample(samples: Samples, time: number, value: number | null): void {
  const { times } = samples;
  if (times.length > 0 && time <= times[times.length - 1]) samples.ascending = false;
  times.push(time);
  samples.values.push(value ?? Number.NaN);
}

/**
 * Long rows (`time, group…, value`): one series per distinct group, named by
 * its group values, in the order the groups are first seen. A stacked chart
 * stacks in that order, so the author's `ORDER BY` says which band is at the
 * bottom.
 */
function readGroupedSeries(
  rows: QueryResultRow[],
  timeKey: string,
  groupKeys: string[],
  valueKey: string,
): Map<string, Samples> {
  const byName = new Map<string, Samples>();
  // Rows of one instant arrive together, so the time of the row before is
  // usually this row's too.
  let parsed = false;
  let lastRaw: QueryResultRow[string] | undefined;
  let lastTime: number | null = null;
  for (const row of rows) {
    const name = groupKeys.map((key) => row[key]).join(" · ");
    let samples = byName.get(name);
    if (!samples) {
      samples = emptySamples();
      byName.set(name, samples);
    }
    const raw = row[timeKey];
    if (!parsed || raw !== lastRaw) {
      parsed = true;
      lastRaw = raw;
      lastTime = toTimestamp(raw);
    }
    if (lastTime === null) continue;
    // Coerce numeric strings (quoted ClickHouse aggregates) to numbers so the
    // chart plots them; non-numeric values become a gap.
    addSample(samples, lastTime, toNumber(row[valueKey]));
  }
  return byName;
}

/** Wide rows (`time, value…`): one series per value column, named by it. */
function readColumnSeries(
  rows: QueryResultRow[],
  timeKey: string,
  valueKeys: string[],
): Map<string, Samples> {
  const byName = new Map(valueKeys.map((name) => [name, emptySamples()]));
  for (const row of rows) {
    const time = toTimestamp(row[timeKey]);
    if (time === null) continue;
    for (const [name, samples] of byName) {
      // A row without the column has no sample here: that is not a gap, and
      // must not break the line.
      if (name in row) addSample(samples, time, toNumber(row[name]));
    }
  }
  return byName;
}

interface Line {
  times: Float64Array;
  values: Float64Array;
}

/** The samples in time order, one per time: of rows that share a time, the
 * last one wins. */
function inTimeOrder({ times, values, ascending }: Samples): Line {
  if (ascending) return { times: Float64Array.from(times), values: Float64Array.from(values) };
  const order = Uint32Array.from(times, (_, index) => index).sort(
    (a, b) => times[a] - times[b] || a - b,
  );
  const line = { times: new Float64Array(order.length), values: new Float64Array(order.length) };
  let count = 0;
  order.forEach((index, position) => {
    const next = order[position + 1];
    if (next !== undefined && times[next] === times[index]) return;
    line.times[count] = times[index];
    line.values[count] = values[index];
    count++;
  });
  return { times: line.times.slice(0, count), values: line.values.slice(0, count) };
}

/** How far apart a line's samples usually are: the median step. Null with
 * fewer than two samples. */
function usualInterval(times: Float64Array): number | null {
  if (times.length < 2) return null;
  const steps = new Float64Array(times.length - 1);
  for (let i = 1; i < times.length; i++) steps[i - 1] = times[i] - times[i - 1];
  steps.sort();
  return steps[Math.floor(steps.length / 2)];
}

/**
 * The line as it is drawn: clamped to the domain, with a marker in each gap.
 *
 * Clamping treats each point as a BUCKET, not an instant: a bucketed
 * timestamp (e.g. ClickHouse `toStartOfInterval`) labels the bucket's start,
 * so the bucket just before `from` still covers in-range rows whenever `from`
 * isn't bucket-aligned. That point is kept when its bucket overlaps the
 * domain; it sits left of the axis and the line clips at the plot edge
 * (Grafana-style) instead of silently losing up to a bucket of data.
 */
function drawnLine({ times, values }: Line, [from, to]: readonly [number, number]): Line {
  // Inferred from ALL samples, pre-clamp, so the leading bucket's width is
  // known even when only one point lands inside the domain.
  const interval = usualInterval(times);
  // Room for a marker between every two points.
  const line = {
    times: new Float64Array(times.length * 2),
    values: new Float64Array(times.length * 2),
  };
  let count = 0;
  let previous: number | null = null;
  for (let i = 0; i < times.length; i++) {
    const time = times[i];
    if (time > to) break;
    if (time < from && !(interval !== null && time + interval > from)) continue;
    if (previous !== null && interval && time - previous > interval * 1.5) {
      line.times[count] = previous + interval;
      line.values[count] = Number.NaN;
      count++;
    }
    line.times[count] = time;
    line.values[count] = values[i];
    count++;
    previous = time;
  }
  return { times: line.times.slice(0, count), values: line.values.slice(0, count) };
}

/** The first index of ascending `times` at or after `time`. */
function indexAtOrAfter(times: Float64Array, time: number): number {
  let index = 0;
  let end = times.length;
  while (index < end) {
    const middle = (index + end) >>> 1;
    if (times[middle] < time) index = middle + 1;
    else end = middle;
  }
  return index;
}

/** Every time of `lines` inside the domain, ascending and distinct. */
function timeline(lines: Line[], [from, to]: readonly [number, number]): Float64Array {
  const inside = lines.map(({ times }) => {
    const start = indexAtOrAfter(times, from);
    let end = indexAtOrAfter(times, to);
    if (times[end] === to) end++;
    return times.subarray(start, Math.max(start, end));
  });
  const [first = new Float64Array(0), ...others] = inside;
  // Series of one query usually share their timestamps: nothing to merge then.
  const shared = others.every(
    (times) => times.length === first.length && times.every((time, i) => time === first[i]),
  );
  if (shared) return first.slice();

  const all = new Float64Array(inside.reduce((total, times) => total + times.length, 0));
  let offset = 0;
  for (const times of inside) {
    all.set(times, offset);
    offset += times.length;
  }
  all.sort();
  let count = 0;
  all.forEach((time, i) => {
    if (i > 0 && time === all[i - 1]) return;
    all[count] = time;
    count++;
  });
  return all.slice(0, count);
}

/**
 * Builds a chart model from every query result set, on one time axis. Each
 * series keeps its own samples; rows of one series that share a time collapse
 * to the last one. `colors` pins a series to a fixed color by name; the rest
 * keep their palette slot, so pinning one series never reshuffles the others.
 */
export function buildChartModel(
  dataSets: QueryResultRow[][],
  domain: readonly [number, number],
  colors: Record<string, string> = {},
): ChartModel {
  const lines: Line[] = [];
  const series: ChartSeries[] = [];

  dataSets.forEach((rows, queryIndex) => {
    if (!rows || rows.length === 0) return;
    const timeKey = detectTimeKey(rows);
    if (!timeKey) return;

    const groupKeys = getGroupKeys(rows, [timeKey]);
    const valueKeys = getValueKeys(rows, timeKey);
    const [groupValueKey] = valueKeys;
    const byName =
      groupKeys.length >= 1 && valueKeys.length === 1 && groupValueKey !== undefined
        ? readGroupedSeries(rows, timeKey, groupKeys, groupValueKey)
        : readColumnSeries(rows, timeKey, valueKeys);

    // The name is unique within its result set, and is the legend and tooltip
    // label. Opaque ids stay unique across queries even when two series share
    // a label.
    for (const [name, samples] of byName) {
      const line = inTimeOrder(samples);
      lines.push(line);
      series.push({
        id: `s${series.length}`,
        identity: JSON.stringify([queryIndex, timeKey, groupKeys, name]),
        label: name,
        color:
          colors[name] ??
          SERIES_COLORS[series.length % SERIES_COLORS.length] ??
          "hsl(263, 90%, 65%)",
        ...drawnLine(line, domain),
      });
    }
  });

  return { times: timeline(lines, domain), series, domain };
}

/**
 * The number each series has at exactly `time`, by series id. A series with
 * no sample there, or one that is not a number, is left out.
 */
export function samplesAt(series: readonly ChartSeries[], time: number): Record<string, number> {
  const samples: Record<string, number> = {};
  for (const { id, times, values } of series) {
    const index = indexAtOrAfter(times, time);
    const value = values[index];
    if (times[index] === time && !Number.isNaN(value)) samples[id] = value;
  }
  return samples;
}
