import type { Feature, Geometry } from "geojson";
import { feature } from "topojson-client";
import worldTopo from "world-atlas/countries-110m.json";

export type CountryFeature = Feature<Geometry, { name?: string }>;

let cached: CountryFeature[] | null = null;

/**
 * The bundled world-atlas countries (110m) as GeoJSON features, converted once
 * and memoized. Each feature's `id` is the numeric ISO-3166 code as a string.
 */
export function getWorldCountries(): CountryFeature[] {
  if (cached) return cached;
  const topo = worldTopo as unknown as Parameters<typeof feature>[0];
  const collection = feature(
    topo,
    (
      topo as unknown as {
        objects: { countries: Parameters<typeof feature>[1] };
      }
    ).objects.countries,
  ) as unknown as {
    features: CountryFeature[];
  };
  cached = collection.features;
  return cached;
}
