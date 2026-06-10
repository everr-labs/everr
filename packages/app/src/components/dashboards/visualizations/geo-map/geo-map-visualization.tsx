import { geoNaturalEarth1, geoPath } from "d3-geo";
import { Map as MapIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { queryLabel, SERIES_COLORS } from "../data-utils";
import type { VisualizationProps } from "../index";
import { formatStatValue } from "../stat-chart/stat-calculations";
import {
  colorRamp,
  deriveDomain,
  extractMarkers,
  markerRadius,
  mergeRegions,
  schemeBaseColor,
} from "./geo-data";
import type { GeoMapSpec } from "./spec";
import { getWorldCountries } from "./world-geometry";

const VW = 980;
const VH = 500;
const R_RANGE: [number, number] = [3, 22];
/** Marker fill opacity — shared by map markers and the legend swatches. */
const MARKER_OPACITY = 0.65;

/** Marker color encodes which query: frame 0 = scheme base, then the palette. */
function markerColor(frame: number, spec: GeoMapSpec): string {
  if (frame === 0) return schemeBaseColor(spec.colorScheme);
  return SERIES_COLORS[frame % SERIES_COLORS.length] ?? SERIES_COLORS[0]!;
}

interface Hover {
  x: number;
  y: number;
  title: string;
  value: number | null;
}

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
    () => geoNaturalEarth1().fitSize([VW, VH], { type: "Sphere" }),
    [],
  );
  const path = useMemo(() => geoPath(projection), [projection]);

  const [hover, setHover] = useState<Hover | null>(null);

  const fmt = (v: number | null) =>
    v == null
      ? "–"
      : `${formatStatValue(v, undefined)}${spec.unit ? ` ${spec.unit}` : ""}`;

  const content = useMemo(() => {
    if (!data) return null;
    if (spec.mode === "choropleth") {
      const { values } = mergeRegions(data, spec);
      const domain = deriveDomain([...values.values()], spec);
      return { kind: "choropleth" as const, values, domain };
    }
    const { markers } = extractMarkers(data, spec);
    const domain = deriveDomain(
      markers.map((m) => m.value).filter((v): v is number => v != null),
      spec,
    );
    return { kind: "points" as const, markers, domain };
  }, [data, spec]);

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
      <div className="min-h-0 flex-1 overflow-hidden">
        <svg
          viewBox={`0 0 ${VW} ${VH}`}
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full"
          role="img"
          aria-label="Geographic map"
        >
          <title>Geographic map</title>

          {/* base land — every country in a muted fill */}
          {countries.map((f) => {
            const d = path(f) ?? undefined;
            if (!d) return null;
            return (
              <path
                key={String(f.id)}
                d={d}
                className="fill-muted stroke-border"
                strokeWidth={0.5}
              />
            );
          })}

          {/* choropleth data — colored overlay (transparent→full) over the land */}
          {content.kind === "choropleth" &&
            countries.map((f) => {
              const v = content.values.get(String(f.id));
              if (v === undefined) return null;
              const d = path(f) ?? undefined;
              if (!d) return null;
              const t = d1 > d0 ? (v - d0) / (d1 - d0) : 1;
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: map region hover
                <path
                  key={`v-${String(f.id)}`}
                  d={d}
                  fill={colorRamp(spec.colorScheme, t)}
                  className="stroke-border"
                  strokeWidth={0.5}
                  onMouseEnter={() => {
                    const c = path.centroid(f);
                    setHover({
                      x: c[0],
                      y: c[1],
                      title: f.properties?.name ?? String(f.id),
                      value: v,
                    });
                  }}
                  onMouseLeave={() => setHover(null)}
                />
              );
            })}

          {content.kind === "points" &&
            content.markers.map((m, i) => {
              const xy = projection([m.lon, m.lat]);
              if (!xy) return null;
              const r = markerRadius(m.value ?? d0, content.domain, R_RANGE);
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: marker hover
                <circle
                  key={`${m.frame}-${i}`}
                  cx={xy[0]}
                  cy={xy[1]}
                  r={r}
                  fill={markerColor(m.frame, spec)}
                  fillOpacity={MARKER_OPACITY}
                  stroke="white"
                  strokeWidth={0.75}
                  onMouseEnter={() =>
                    setHover({
                      x: xy[0],
                      y: xy[1],
                      title:
                        m.label ?? `${m.lat.toFixed(2)}, ${m.lon.toFixed(2)}`,
                      value: m.value,
                    })
                  }
                  onMouseLeave={() => setHover(null)}
                />
              );
            })}

          {hover && (
            <g
              transform={`translate(${hover.x}, ${hover.y})`}
              pointerEvents="none"
            >
              <rect
                x={8}
                y={-28}
                width={160}
                height={34}
                rx={4}
                fill="rgba(17,24,39,0.92)"
              />
              <text x={16} y={-14} fill="white" fontSize={12} fontWeight={600}>
                {hover.title.slice(0, 22)}
              </text>
              <text x={16} y={1} fill="white" fontSize={12} opacity={0.85}>
                {fmt(hover.value)}
              </text>
            </g>
          )}

          {spec.showLegend && content.kind === "points" && frameCount > 1 && (
            <g transform={`translate(12, ${VH - 12 - frameCount * 18})`}>
              {Array.from({ length: frameCount }, (_, f) => (
                <g key={f} transform={`translate(0, ${f * 18})`}>
                  <circle
                    cx={6}
                    cy={6}
                    r={6}
                    fill={markerColor(f, spec)}
                    fillOpacity={MARKER_OPACITY}
                    stroke="white"
                    strokeWidth={0.75}
                  />
                  <text x={18} y={10} fontSize={12} className="fill-foreground">
                    {queryLabel(f)}
                  </text>
                </g>
              ))}
            </g>
          )}
          {spec.showLegend && content.kind === "choropleth" && (
            <g transform={`translate(12, ${VH - 40})`}>
              <defs>
                <linearGradient id="geo-ramp" x1="0" x2="1" y1="0" y2="0">
                  <stop
                    offset="0%"
                    stopColor={schemeBaseColor(spec.colorScheme)}
                    stopOpacity={0}
                  />
                  <stop
                    offset="100%"
                    stopColor={schemeBaseColor(spec.colorScheme)}
                    stopOpacity={1}
                  />
                </linearGradient>
              </defs>
              <rect
                x={0}
                y={0}
                width={160}
                height={10}
                rx={2}
                className="fill-muted"
              />
              <rect
                x={0}
                y={0}
                width={160}
                height={10}
                rx={2}
                fill="url(#geo-ramp)"
              />
              <text
                x={0}
                y={24}
                fontSize={11}
                className="fill-muted-foreground"
              >
                {fmt(d0)}
              </text>
              <text
                x={160}
                y={24}
                fontSize={11}
                textAnchor="end"
                className="fill-muted-foreground"
              >
                {fmt(d1)}
              </text>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
