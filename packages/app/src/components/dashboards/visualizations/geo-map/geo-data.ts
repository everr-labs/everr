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

/** Full saturated color per scheme (markers + choropleth high end). */
const SCHEME_COLOR: Record<GeoColorScheme, [number, number, number]> = {
  blue: [37, 99, 235],
  green: [22, 163, 74],
  orange: [234, 88, 12],
  red: [220, 38, 38],
};

/**
 * Choropleth fill for a scheme at position t in [0,1]: the scheme's full color
 * at opacity t, so low values fade toward transparent (revealing the land
 * beneath) and high values reach full color. Avoids a washed-out white low end
 * on dark backgrounds.
 */
export function colorRamp(scheme: GeoColorScheme, t: number): string {
  const [r, g, b] = SCHEME_COLOR[scheme];
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  const a = Math.round(u * 1000) / 1000;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** The scheme's full color — used as a points-mode marker base color. */
export function schemeBaseColor(scheme: GeoColorScheme): string {
  const [r, g, b] = SCHEME_COLOR[scheme];
  return `rgb(${r}, ${g}, ${b})`;
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
export function deriveDomain(
  vals: number[],
  spec: GeoMapSpec,
): [number, number] {
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
