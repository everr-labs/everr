import { toNumber } from "../data-utils";
import type { QueryResultRow } from "../index";
import { regionToNumericId } from "./country-codes";
import type { GeoColorScheme, GeoMapSpec } from "./spec";

export interface GeoMarker {
  lat: number;
  lon: number;
  value: number | null;
  frame: number;
  label: string | undefined;
}

/** Light → dark anchors per scheme, interpolated for choropleth fills. */
const RAMP: Record<GeoColorScheme, [[number, number, number], [number, number, number]]> = {
  blue: [
    [219, 234, 254],
    [30, 64, 175],
  ],
  green: [
    [220, 252, 231],
    [22, 101, 52],
  ],
  orange: [
    [255, 237, 213],
    [154, 52, 18],
  ],
  red: [
    [254, 226, 226],
    [153, 27, 27],
  ],
};

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** Interpolated fill color for a choropleth scheme at position t in [0,1]. */
export function colorRamp(scheme: GeoColorScheme, t: number): string {
  const [lo, hi] = RAMP[scheme];
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return `rgb(${lerp(lo[0], hi[0], u)}, ${lerp(lo[1], hi[1], u)}, ${lerp(lo[2], hi[2], u)})`;
}

/** The saturated end of a scheme — used as a points-mode marker base color. */
export function schemeBaseColor(scheme: GeoColorScheme): string {
  const [, hi] = RAMP[scheme];
  return `rgb(${hi[0]}, ${hi[1]}, ${hi[2]})`;
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
      markers.push({ lat, lon, value: toNumber(row[spec.valueColumn]), frame, label });
    }
  });
  return { markers, skipped };
}

/** Region→summed-value map across all frames; unknown codes are counted. */
export function mergeRegions(
  frames: QueryResultRow[][],
  spec: GeoMapSpec,
): { values: Map<string, number>; unmatched: number } {
  const values = new Map<string, number>();
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
      values.set(id, (values.get(id) ?? 0) + v);
    }
  }
  return { values, unmatched };
}

/** [min,max] color/size domain: explicit spec bounds win, else data extent. */
export function deriveDomain(vals: number[], spec: GeoMapSpec): [number, number] {
  const min = spec.min ?? (vals.length ? Math.min(...vals) : 0);
  const max = spec.max ?? (vals.length ? Math.max(...vals) : 1);
  return [min, max];
}

/** Linear map of value over [domainMin,domainMax] onto [rMin,rMax], clamped. */
export function markerRadius(
  value: number,
  [d0, d1]: [number, number],
  [r0, r1]: [number, number],
): number {
  if (d1 <= d0) return r0;
  const t = (value - d0) / (d1 - d0);
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return r0 + (r1 - r0) * u;
}
