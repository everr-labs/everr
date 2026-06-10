import { geoNaturalEarth1, geoPath } from "d3-geo";
import { Map as MapIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
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
import type { GeoColorScheme, GeoMapSpec } from "./spec";
import { getWorldCountries } from "./world-geometry";

const VW = 980;
const VH = 500;
const R_RANGE: [number, number] = [3, 22];
/** Marker fill opacity — shared by map markers and the legend swatches. */
const MARKER_OPACITY = 0.65;

/** SERIES_COLORS index each scheme resembles — skipped when picking the
 *  secondary marker colors so multi-query overlays stay visually distinct. */
const SCHEME_SERIES_INDEX: Record<GeoColorScheme, number> = {
  blue: 0,
  green: 1,
  red: 2,
  orange: 4,
};

/** Marker color encodes which query: frame 0 = scheme base; later frames use
 *  the shared palette, skipping the hue closest to the scheme color. */
function markerColor(frame: number, spec: GeoMapSpec): string {
  if (frame === 0) return schemeBaseColor(spec.colorScheme);
  const secondary = SERIES_COLORS.filter(
    (_, i) => i !== SCHEME_SERIES_INDEX[spec.colorScheme],
  );
  return secondary[(frame - 1) % secondary.length] ?? SERIES_COLORS[0]!;
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
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Pointer position relative to the container, for HTML-overlay tooltips.
  const posFromEvent = (e: { clientX: number; clientY: number }) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

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
      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 overflow-hidden"
      >
        <svg
          viewBox={`0 0 ${VW} ${VH}`}
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full"
          role="img"
          aria-label="Geographic map"
          onMouseMove={(e) => {
            const p = posFromEvent(e);
            setHover((h) => (h && p ? { ...h, x: p.x, y: p.y } : h));
          }}
          onMouseLeave={() => setHover(null)}
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
              const title = f.properties?.name ?? String(f.id);
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: map region hover
                <path
                  key={`v-${String(f.id)}`}
                  d={d}
                  fill={colorRamp(spec.colorScheme, t)}
                  className="stroke-border"
                  strokeWidth={0.5}
                  onMouseEnter={(e) => {
                    const p = posFromEvent(e);
                    if (p) setHover({ ...p, title, value: v });
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
              const title =
                m.label ?? `${m.lat.toFixed(2)}, ${m.lon.toFixed(2)}`;
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
                  onMouseEnter={(e) => {
                    const p = posFromEvent(e);
                    if (p) setHover({ ...p, title, value: m.value });
                  }}
                  onMouseLeave={() => setHover(null)}
                />
              );
            })}
        </svg>

        {/* tooltip — constant-size HTML overlay (stays readable as the map scales) */}
        {hover && (
          <div
            className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs shadow-md"
            style={{
              left: hover.x,
              top: hover.y,
              transform: "translate(10px, -120%)",
            }}
          >
            <div className="font-semibold text-popover-foreground">
              {hover.title}
            </div>
            <div className="text-muted-foreground">{fmt(hover.value)}</div>
          </div>
        )}

        {/* legend — HTML overlay, constant size */}
        {spec.showLegend && content.kind === "points" && frameCount > 1 && (
          <div className="pointer-events-none absolute bottom-2 left-2 flex flex-col gap-1 rounded-md bg-background/70 px-2 py-1.5 text-xs backdrop-blur-sm">
            {Array.from({ length: frameCount }, (_, f) => (
              <div key={f} className="flex items-center gap-2">
                <span
                  className="size-3 rounded-full ring-1 ring-white/70"
                  style={{
                    backgroundColor: markerColor(f, spec),
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
                  background: `linear-gradient(to right, transparent, ${schemeBaseColor(spec.colorScheme)})`,
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
