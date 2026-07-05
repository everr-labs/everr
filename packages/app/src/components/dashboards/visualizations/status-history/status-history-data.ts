import type { QueryResultRow } from "../index";
import { assignStateColors, collectLaneSamples } from "../lane-timeline-data";
import type { StatusHistorySpec } from "./spec";

export interface StatusCell {
  /** Sample instant in ms — the cell is centered on it. */
  ts: number;
  /** Cell bounds in ms, clamped to the domain. */
  start: number;
  end: number;
  state: string;
}

export interface StatusHistoryLane {
  label: string;
  cells: StatusCell[];
}

export interface StatusHistoryModel {
  /** One lane per column (wide) or per `seriesColumn` value (long), in first-seen order. */
  lanes: StatusHistoryLane[];
  /** Distinct visible statuses in first-seen order (legend order). */
  states: string[];
  colorByState: Record<string, string>;
}

/** Slot width when the data has fewer than two distinct timestamps and no
 * sampling interval can be measured. */
const FALLBACK_SLOT_FRACTION = 1 / 20;

/**
 * Lanes of discrete status cells, one per sample. Unlike StateTimeline, a
 * sample does NOT hold until the lane's next sample: each one renders as a
 * fixed-width cell centered on its timestamp, sized to the sampling interval
 * (the smallest gap between distinct timestamps across all lanes) times
 * `colWidth` — so a missing sample shows as an empty slot instead of being
 * painted over by its predecessor. A null/missing status is no cell; cells
 * are clamped to the domain and dropped when they fall entirely outside it
 * (overlap is judged on the cell, not the timestamp — a sample sitting right
 * on the range edge still paints its visible half).
 *
 * Color encodes the status: a `spec.colors` entry when present, else the
 * shared palette in first-seen order (mapped statuses don't consume palette
 * slots).
 */
export function buildStatusHistoryModel(
  frames: QueryResultRow[][],
  spec: StatusHistorySpec,
  domain: [number, number],
): StatusHistoryModel {
  const samplesByLane = collectLaneSamples(frames, spec);

  // Sampling interval: smallest gap between consecutive distinct timestamps
  // across all lanes. One shared slot width keeps cells aligned across lanes
  // even when individual lanes have missing samples.
  const allTimestamps = [
    ...new Set([...samplesByLane.values()].flatMap((samples) => [...samples.keys()])),
  ].sort((a, b) => a - b);
  let interval = Number.POSITIVE_INFINITY;
  for (let i = 1; i < allTimestamps.length; i++) {
    interval = Math.min(interval, allTimestamps[i]! - allTimestamps[i - 1]!);
  }
  if (!Number.isFinite(interval)) {
    interval = (domain[1] - domain[0]) * FALLBACK_SLOT_FRACTION;
  }
  const halfCell = (interval * spec.colWidth) / 2;

  const states: string[] = [];
  const lanes: StatusHistoryLane[] = [];
  for (const [label, samples] of samplesByLane) {
    const sorted = [...samples.entries()].sort((a, b) => a[0] - b[0]);
    const cells: StatusCell[] = [];
    for (const [ts, state] of sorted) {
      if (state === null) continue;
      const start = Math.max(ts - halfCell, domain[0]);
      const end = Math.min(ts + halfCell, domain[1]);
      if (end <= start) continue;
      if (!states.includes(state)) states.push(state);
      cells.push({ ts, start, end, state });
    }
    lanes.push({ label, cells });
  }

  return {
    lanes,
    states,
    colorByState: assignStateColors(states, spec.colors),
  };
}
