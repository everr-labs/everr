import { normalizeValue, type ScaleType } from "../color-scale";
import { toNumber } from "../data-utils";
import type { QueryResultRow } from "../index";
import { regionToNumericId } from "./country-codes";
import type { GeoMapSpec } from "./spec";

export interface GeoMarker {
  lat: number;
  lon: number;
  value: number | null;
  frame: number;
  label: string | undefined;
}

function validLat(n: number): boolean {
  return n >= -90 && n <= 90;
}
function validLon(n: number): boolean {
  return n >= -180 && n <= 180;
}

/** Markers from every frame's rows; rows with invalid coordinates are skipped. */
export function extractMarkers(
  frames: QueryResultRow[][],
  spec: GeoMapSpec,
): { markers: GeoMarker[]; skipped: number } {
  const markers: GeoMarker[] = [];
  let skipped = 0;
  frames.forEach((rows, frame) => {
    for (const row of rows) {
      const lat = toNumber(row[spec.latColumn]);
      const lon = toNumber(row[spec.lonColumn]);
      if (lat === null || lon === null || !validLat(lat) || !validLon(lon)) {
        skipped++;
        continue;
      }
      const label =
        spec.labelColumn && row[spec.labelColumn] != null
          ? String(row[spec.labelColumn])
          : undefined;
      markers.push({
        lat,
        lon,
        value: toNumber(row[spec.valueColumn]),
        frame,
        label,
      });
    }
  });
  return { markers, skipped };
}

/**
 * Region→value map across all frames, combining rows that hit the same region
 * with `spec.aggregation`; unknown codes are counted. `sum` is only correct
 * for additive metrics — `avg`/`max`/etc. exist for latencies and rates.
 * `last` follows result-set order (frames in query order, rows as returned),
 * so it is only meaningful when the query orders its rows.
 */
export function mergeRegions(
  frames: QueryResultRow[][],
  spec: GeoMapSpec,
): { values: Map<string, number>; unmatched: number } {
  interface Acc {
    sum: number;
    count: number;
    min: number;
    max: number;
    last: number;
  }
  const acc = new Map<string, Acc>();
  let unmatched = 0;
  for (const rows of frames) {
    for (const row of rows) {
      const raw = row[spec.regionColumn];
      const id = raw == null ? undefined : regionToNumericId(String(raw));
      if (!id) {
        unmatched++;
        continue;
      }
      const v = toNumber(row[spec.valueColumn]) ?? 0;
      const a = acc.get(id);
      if (!a) {
        acc.set(id, { sum: v, count: 1, min: v, max: v, last: v });
      } else {
        a.sum += v;
        a.count++;
        if (v < a.min) a.min = v;
        if (v > a.max) a.max = v;
        a.last = v;
      }
    }
  }
  const finalize = (a: Acc): number => {
    switch (spec.aggregation) {
      case "avg":
        return a.sum / a.count;
      case "min":
        return a.min;
      case "max":
        return a.max;
      case "last":
        return a.last;
      default:
        return a.sum;
    }
  };
  const values = new Map<string, number>();
  for (const [id, a] of acc) values.set(id, finalize(a));
  return { values, unmatched };
}

/**
 * [min,max] color/size domain: explicit spec bounds win, else data extent.
 * `zeroFloor` extends an all-positive extent down to 0 — the choropleth ramp
 * fades to transparent at the domain min, so anchoring at the data min would
 * render the lowest-valued region invisible (indistinguishable from no data)
 * and make the legend read min→max instead of 0→max.
 */
export function deriveDomain(
  vals: number[],
  spec: GeoMapSpec,
  opts?: { zeroFloor?: boolean },
): [number, number] {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const v of vals) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  let min = spec.min ?? (vals.length ? lo : 0);
  if (opts?.zeroFloor && spec.min === undefined && min > 0) min = 0;
  const max = spec.max ?? (vals.length ? hi : 1);
  return [min, max];
}

/** Marker radius for a value: [rMin,rMax] scaled by the normalized value. */
export function markerRadius(
  value: number,
  domain: [number, number],
  [r0, r1]: [number, number],
  scale: ScaleType = "linear",
): number {
  if (domain[1] <= domain[0]) return r0;
  return r0 + (r1 - r0) * normalizeValue(value, domain, scale);
}
