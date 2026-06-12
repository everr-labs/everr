import { detectTimeKey, SERIES_COLORS, toTimestamp } from "./data-utils";
import type { QueryResultRow } from "./index";

/** Per lane: timestamp → state (null = no sample). */
export type LaneSamples = Map<string, Map<number, string | null>>;

interface LaneSampleSpec {
  /** Long-format series column — one lane per distinct value. */
  seriesColumn?: string;
  /** State column for long format; defaults to the first remaining column. */
  stateColumn?: string;
}

/**
 * Collect per-lane (timestamp → state) samples from every frame — the shared
 * input model for the StateTimeline and StatusHistory charts. Wide format
 * (default): every non-time column is its own lane. Long format
 * (`seriesColumn` set): one lane per series value, state from `stateColumn`
 * (or the first column that is neither time nor series). Duplicate timestamps
 * within a lane are last-write-wins; the Map preserves first-seen lane order
 * across frames. A null/missing state is recorded as null — the caller decides
 * how an absent state renders (a gap vs an empty slot).
 */
export function collectLaneSamples(
  frames: QueryResultRow[][],
  spec: LaneSampleSpec,
): LaneSamples {
  const samplesByLane: LaneSamples = new Map();
  const laneSamples = (label: string) => {
    let samples = samplesByLane.get(label);
    if (!samples) {
      samples = new Map();
      samplesByLane.set(label, samples);
    }
    return samples;
  };

  for (const rows of frames) {
    if (!rows || rows.length === 0) continue;
    const timeKey = detectTimeKey(rows);
    if (!timeKey) continue;
    const first = rows[0]!;

    if (spec.seriesColumn !== undefined && spec.seriesColumn in first) {
      // Long format: one lane per seriesColumn value.
      const seriesKey = spec.seriesColumn;
      const stateKey =
        spec.stateColumn ??
        Object.keys(first).find((k) => k !== timeKey && k !== seriesKey);
      if (stateKey === undefined) continue;
      for (const row of rows) {
        const ts = toTimestamp(row[timeKey]);
        const lane = row[seriesKey];
        if (ts === null || lane == null) continue;
        const state = row[stateKey];
        laneSamples(String(lane)).set(ts, state == null ? null : String(state));
      }
    } else {
      // Wide format: one lane per non-time column.
      const laneKeys = Object.keys(first).filter((k) => k !== timeKey);
      for (const row of rows) {
        const ts = toTimestamp(row[timeKey]);
        if (ts === null) continue;
        for (const key of laneKeys) {
          const state = row[key];
          laneSamples(key).set(ts, state == null ? null : String(state));
        }
      }
    }
  }
  return samplesByLane;
}

/**
 * Map visible states to colors: a `colors` entry when present, else the shared
 * palette in first-seen order. Mapped states don't consume palette slots.
 */
export function assignStateColors(
  states: string[],
  colors: Record<string, string>,
): Record<string, string> {
  const colorByState: Record<string, string> = {};
  let paletteIndex = 0;
  for (const state of states) {
    colorByState[state] =
      colors[state] ?? SERIES_COLORS[paletteIndex++ % SERIES_COLORS.length]!;
  }
  return colorByState;
}
