import {
  type GeoProjection as D3Projection,
  geoEqualEarth,
  geoMercator,
  geoNaturalEarth1,
  geoPath,
} from "d3-geo";
import { Map as MapIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { CursorTooltip } from "@/components/cursor-tooltip";
import { colorRamp, normalizeValue, schemeBaseColor } from "../color-scale";
import { queryLabel, SERIES_COLORS } from "../data-utils";
import type { VisualizationProps } from "../index";
import { formatStatValue } from "../stat-chart/stat-calculations";
import {
  deriveDomain,
  extractMarkers,
  type GeoMarker,
  markerRadius,
  mergeRegions,
} from "./geo-data";
import type { GeoColorScheme, GeoMapSpec, GeoProjection } from "./spec";
import { getWorldCountries } from "./world-geometry";

const VW = 980;
const VH = 500;
/** Marker fill opacity — shared by map markers and the legend swatches. */
const MARKER_OPACITY = 0.65;

const PROJECTIONS: Record<GeoProjection, () => D3Projection> = {
  naturalEarth1: geoNaturalEarth1,
  mercator: geoMercator,
  equalEarth: geoEqualEarth,
};

/** SERIES_COLORS index each scheme resembles — skipped when picking the
 *  secondary marker colors so multi-query overlays stay visually distinct. */
const SCHEME_SERIES_INDEX: Record<GeoColorScheme, number> = {
  blue: 0,
  green: 1,
  red: 2,
  orange: 4,
};

/** Per-scheme secondary palette (SERIES_COLORS minus the scheme's own hue),
 *  precomputed once instead of filtered per marker per render. */
const SECONDARY_COLORS = Object.fromEntries(
  (Object.keys(SCHEME_SERIES_INDEX) as GeoColorScheme[]).map((scheme) => [
    scheme,
    SERIES_COLORS.filter((_, i) => i !== SCHEME_SERIES_INDEX[scheme]),
  ]),
) as Record<GeoColorScheme, string[]>;

/** Marker color encodes which query: frame 0 = scheme base; later frames use
 *  the shared palette, skipping the hue closest to the scheme color. */
function markerColor(frame: number, scheme: GeoColorScheme): string {
  if (frame === 0) return schemeBaseColor(scheme);
  const secondary = SECONDARY_COLORS[scheme];
  return secondary[(frame - 1) % secondary.length] ?? schemeBaseColor(scheme);
}

interface Hover {
  title: string;
  value: number | null;
  x: number;
  y: number;
}

type SizedMarker = GeoMarker & { r: number };

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <MapIcon className="size-8" />
      <p className="text-sm">No mappable data in this result</p>
    </div>
  );
}

export function GeoMapVisualization({
  spec,
  data,
}: VisualizationProps<GeoMapSpec>) {
  const countries = getWorldCountries();

  const projection = useMemo(
    () => PROJECTIONS[spec.projection]().fitSize([VW, VH], { type: "Sphere" }),
    [spec.projection],
  );

  /** Serialized path + identity per country, computed once per projection —
   *  hover re-renders must not re-run d3's geometry serialization. A few
   *  disputed territories (Kosovo, Somaliland, N. Cyprus) carry no numeric id
   *  in world-atlas, so the React key falls back to the name to stay unique. */
  const countryPaths = useMemo(() => {
    const path = geoPath(projection);
    return countries.flatMap((f) => {
      const d = path(f);
      if (!d) return [];
      const id = f.id == null ? undefined : String(f.id);
      const name = f.properties?.name;
      return [{ key: id ?? name ?? "unnamed", id, d, name: name ?? "Unknown" }];
    });
  }, [countries, projection]);

  const [hover, setHover] = useState<Hover | null>(null);

  const fmt = (v: number | null) =>
    v == null
      ? "–"
      : `${formatStatValue(v, undefined)}${spec.unit ? ` ${spec.unit}` : ""}`;

  const content = useMemo(() => {
    if (!data) return null;
    if (spec.mode === "choropleth") {
      const { values, unmatched } = mergeRegions(data, spec);
      const domain = deriveDomain([...values.values()], spec, {
        zeroFloor: true,
      });
      return {
        kind: "choropleth" as const,
        values,
        domain,
        dropped: unmatched,
      };
    }
    const { markers, skipped } = extractMarkers(data, spec);
    const vals = markers
      .map((m) => m.value)
      .filter((v): v is number => v != null);
    const domain = deriveDomain(vals, spec);
    const rRange: [number, number] = [
      spec.minRadius,
      Math.max(spec.minRadius, spec.maxRadius),
    ];
    // Big markers first so small overlapping ones stay on top and hoverable.
    const sized: SizedMarker[] = markers
      .map((m) => ({
        ...m,
        r: markerRadius(m.value ?? domain[0], domain, rRange, spec.scaleType),
      }))
      .sort((a, b) => b.r - a.r);
    return {
      kind: "points" as const,
      markers: sized,
      domain,
      dropped: skipped,
      hasValues: vals.length > 0,
    };
  }, [data, spec]);

  // base land — every country in a muted fill; static per projection
  const baseLand = useMemo(
    () =>
      countryPaths.map((c) => (
        <path
          key={c.key}
          d={c.d}
          className="fill-muted stroke-border"
          strokeWidth={0.5}
        />
      )),
    [countryPaths],
  );

  // choropleth data — colored overlay (transparent→full) over the land
  const choroplethLayer = useMemo(() => {
    if (content?.kind !== "choropleth") return null;
    return countryPaths.map((c) => {
      const v = c.id === undefined ? undefined : content.values.get(c.id);
      if (v === undefined) return null;
      const t = normalizeValue(v, content.domain, spec.scaleType);
      return (
        // biome-ignore lint/a11y/noStaticElementInteractions: map region hover
        <path
          key={`v-${c.key}`}
          d={c.d}
          fill={colorRamp(spec.colorScheme, t)}
          className="stroke-border"
          strokeWidth={0.5}
          onMouseEnter={(e) =>
            setHover({ title: c.name, value: v, x: e.clientX, y: e.clientY })
          }
          onMouseLeave={() => setHover(null)}
        />
      );
    });
  }, [content, countryPaths, spec.colorScheme, spec.scaleType]);

  const markersLayer = useMemo(() => {
    if (content?.kind !== "points") return null;
    return content.markers.map((m, i) => {
      const xy = projection([m.lon, m.lat]);
      if (!xy) return null;
      const title = m.label ?? `${m.lat.toFixed(2)}, ${m.lon.toFixed(2)}`;
      return (
        // biome-ignore lint/a11y/noStaticElementInteractions: marker hover
        <circle
          key={`${m.frame}-${i}`}
          cx={xy[0]}
          cy={xy[1]}
          r={m.r}
          fill={markerColor(m.frame, spec.colorScheme)}
          fillOpacity={MARKER_OPACITY}
          stroke="white"
          strokeWidth={0.75}
          onMouseEnter={(e) =>
            setHover({ title, value: m.value, x: e.clientX, y: e.clientY })
          }
          onMouseLeave={() => setHover(null)}
        />
      );
    });
  }, [content, projection, spec.colorScheme]);

  if (!content) return <EmptyState />;
  const hasData =
    content.kind === "choropleth"
      ? content.values.size > 0
      : content.markers.length > 0;
  if (!hasData) return <EmptyState />;

  const [d0, d1] = content.domain;
  const frameCount = data?.length ?? 0;

  return (
    <div className="flex h-full flex-col border-t border-border">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <svg
          viewBox={`0 0 ${VW} ${VH}`}
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full"
          role="img"
          aria-label="Geographic map"
          onMouseMove={(e) =>
            setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))
          }
          onMouseLeave={() => setHover(null)}
        >
          <title>Geographic map</title>
          {baseLand}
          {choroplethLayer}
          {markersLayer}
        </svg>

        {/* tooltip — constant-size HTML overlay (stays readable as the map scales) */}
        {hover && (
          <CursorTooltip x={hover.x} y={hover.y}>
            <div className="font-semibold">{hover.title}</div>
            <div className="text-muted-foreground">{fmt(hover.value)}</div>
          </CursorTooltip>
        )}

        {/* rows the result contained but the map could not place */}
        {content.dropped > 0 && (
          <div className="pointer-events-none absolute top-2 right-2 rounded-md bg-background/70 px-2 py-1 text-xs text-muted-foreground backdrop-blur-sm">
            {content.dropped} row{content.dropped === 1 ? "" : "s"} not mapped
          </div>
        )}

        {/* legend — HTML overlay, constant size. Points mode shows the
            value→size mapping (smallest/largest marker with the domain
            bounds) plus per-query swatches for multi-query overlays. */}
        {spec.showLegend &&
          content.kind === "points" &&
          ((content.hasValues && d1 > d0) || frameCount > 1) && (
            <div className="pointer-events-none absolute bottom-2 left-2 flex flex-col gap-1.5 rounded-md bg-background/70 px-2 py-1.5 text-xs backdrop-blur-sm">
              {content.hasValues && d1 > d0 && (
                <div className="flex items-center gap-1.5">
                  <span
                    className="shrink-0 rounded-full ring-1 ring-white/70"
                    style={{
                      width: 6,
                      height: 6,
                      backgroundColor: schemeBaseColor(spec.colorScheme),
                      opacity: MARKER_OPACITY,
                    }}
                  />
                  <span className="text-muted-foreground">{fmt(d0)}</span>
                  <span
                    className="ml-1 shrink-0 rounded-full ring-1 ring-white/70"
                    style={{
                      width: 14,
                      height: 14,
                      backgroundColor: schemeBaseColor(spec.colorScheme),
                      opacity: MARKER_OPACITY,
                    }}
                  />
                  <span className="text-muted-foreground">{fmt(d1)}</span>
                </div>
              )}
              {frameCount > 1 &&
                Array.from({ length: frameCount }, (_, f) => (
                  <div key={f} className="flex items-center gap-2">
                    <span
                      className="size-3 rounded-full ring-1 ring-white/70"
                      style={{
                        backgroundColor: markerColor(f, spec.colorScheme),
                        opacity: MARKER_OPACITY,
                      }}
                    />
                    <span className="text-foreground">{queryLabel(f)}</span>
                  </div>
                ))}
            </div>
          )}
        {spec.showLegend && content.kind === "choropleth" && (
          <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-2 rounded-md bg-background/70 px-2 py-1.5 text-xs backdrop-blur-sm">
            <span className="text-muted-foreground">{fmt(d0)}</span>
            <span className="inline-block h-2.5 w-28 rounded-sm bg-muted align-middle">
              <span
                className="block h-full w-full rounded-sm"
                style={{
                  // Sampled through the scale curve so the ramp matches the
                  // actual region fills under sqrt/log scales too.
                  background: `linear-gradient(to right, ${[
                    0, 0.25, 0.5, 0.75, 1,
                  ]
                    .map((p) => {
                      const v = d0 + p * (d1 - d0);
                      const t = normalizeValue(
                        v,
                        content.domain,
                        spec.scaleType,
                      );
                      return `${colorRamp(spec.colorScheme, t)} ${p * 100}%`;
                    })
                    .join(", ")})`,
                }}
              />
            </span>
            <span className="text-muted-foreground">{fmt(d1)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
