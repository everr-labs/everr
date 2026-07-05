import type { QueryResultRow } from "../index";
import { assignStateColors, collectLaneSamples } from "../lane-timeline-data";
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
  const samplesByLane = collectLaneSamples(frames, spec);

  const states: string[] = [];
  const lanes: StateTimelineLane[] = [];
  for (const [label, samples] of samplesByLane) {
    const sorted = [...samples.entries()].sort((a, b) => a[0] - b[0]);
    const segments: StateSegment[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const [ts, state] = sorted[i];
      if (state === null) continue;
      const start = Math.max(ts, domain[0]);
      const end = Math.min(i + 1 < sorted.length ? sorted[i + 1][0] : domain[1], domain[1]);
      if (end <= start) continue;
      if (!states.includes(state)) states.push(state);
      const prev = segments.at(-1);
      if (spec.mergeConsecutive && prev?.state === state && prev.end === start) {
        prev.end = end;
      } else {
        segments.push({ start, end, state });
      }
    }
    lanes.push({ label, segments });
  }

  return {
    lanes,
    states,
    colorByState: assignStateColors(states, spec.colors),
  };
}
