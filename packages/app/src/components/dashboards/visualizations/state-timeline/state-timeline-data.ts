import { detectTimeKey, SERIES_COLORS, toTimestamp } from "../data-utils";
import type { QueryResultRow } from "../index";
import type { StateTimelineSpec } from "./spec";

export interface StateSegment {
  /** Segment bounds in ms, clamped to the domain. */
  start: number;
  end: number;
  state: string;
}

export interface StateTimelineLane {
  label: string;
  segments: StateSegment[];
}

export interface StateTimelineModel {
  /** One lane per column (wide) or per `seriesColumn` value (long), in first-seen order. */
  lanes: StateTimelineLane[];
  /** Distinct visible states in first-seen order (legend order). */
  states: string[];
  colorByState: Record<string, string>;
}

/**
 * Lanes of contiguous state segments from every frame's rows. Each sample's
 * state holds from its timestamp until the lane's next sample; the last sample
 * holds to the end of the domain (a state persists until something changes
 * it). A null/missing state is a gap — no segment. Segments are clamped to the
 * domain, so a sample before `from` still paints the window it covers, and
 * with `mergeConsecutive` adjacent samples sharing a state collapse into one
 * segment.
 *
 * Color encodes the state: a `spec.colors` entry when present, else the shared
 * palette in first-seen order (mapped states don't consume palette slots).
 */
export function buildStateTimelineModel(
  frames: QueryResultRow[][],
  spec: StateTimelineSpec,
  domain: [number, number],
): StateTimelineModel {
  // Per lane: ts → state (null = gap), collapsed last-write-wins on duplicate
  // timestamps. Map preserves first-seen lane order across frames.
  const samplesByLane = new Map<string, Map<number, string | null>>();
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

  const states: string[] = [];
  const lanes: StateTimelineLane[] = [];
  for (const [label, samples] of samplesByLane) {
    const sorted = [...samples.entries()].sort((a, b) => a[0] - b[0]);
    const segments: StateSegment[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const [ts, state] = sorted[i]!;
      if (state === null) continue;
      const start = Math.max(ts, domain[0]);
      const end = Math.min(
        i + 1 < sorted.length ? sorted[i + 1]![0] : domain[1],
        domain[1],
      );
      if (end <= start) continue;
      if (!states.includes(state)) states.push(state);
      const prev = segments.at(-1);
      if (
        spec.mergeConsecutive &&
        prev?.state === state &&
        prev.end === start
      ) {
        prev.end = end;
      } else {
        segments.push({ start, end, state });
      }
    }
    lanes.push({ label, segments });
  }

  const colorByState: Record<string, string> = {};
  let paletteIndex = 0;
  for (const state of states) {
    colorByState[state] =
      spec.colors[state] ??
      SERIES_COLORS[paletteIndex++ % SERIES_COLORS.length]!;
  }

  return { lanes, states, colorByState };
}
