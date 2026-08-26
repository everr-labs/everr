import { CursorTooltip } from "@everr/ui/components/cursor-tooltip";
import { SeriesTooltipContent } from "@everr/ui/components/series-tooltip";
import { Grid3x3 } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { normalizeValue } from "../color-scale";
import {
  createTimeTickFormatter,
  generateTimeTicks,
  SERIES_COLORS,
} from "../data-utils";
import type { VisualizationProps } from "../index";
import { formatStatValue } from "../stat-chart/stat-calculations";
import { heatmapColor, heatmapColorRgb, isDarkColor } from "./heatmap-colors";
import { buildHeatmapModel, type HeatmapCell } from "./heatmap-data";
import type { HeatmapSpec } from "./spec";

const BRUSH_COLOR = SERIES_COLORS[0]!;
const MAX_X_TICKS = 6;
/** Bucket label gutter width — the axis row and brush overlay offset by the
 * same amount so they stay aligned with the cell tracks. */
const LABEL_WIDTH = 96;

function formatValue(value: number, unit: string): string {
  return `${formatStatValue(value, undefined)}${unit ? ` ${unit}` : ""}`;
}

interface HoverState {
  bucket: string;
  cell: HeatmapCell;
  x: number;
  y: number;
}

export function HeatmapVisualization({
  spec,
  data,
  timeRange,
  onTimeRangeChange,
}: VisualizationProps<HeatmapSpec>) {
  const trackRef = useRef<HTMLDivElement>(null);
  const trackRectRef = useRef<DOMRect | null>(null);
  const [brushStart, setBrushStart] = useState<number | null>(null);
  const [brushEnd, setBrushEnd] = useState<number | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const domain = useMemo<[number, number]>(
    () => [timeRange.from.getTime(), timeRange.to.getTime()],
    [timeRange],
  );
  const span = domain[1] - domain[0];

  const model = useMemo(
    () => (data ? buildHeatmapModel(data, spec, domain) : null),
    [data, spec, domain],
  );

  const ticks = useMemo(() => generateTimeTicks(domain, MAX_X_TICKS), [domain]);
  const formatTick = useMemo(() => createTimeTickFormatter(domain), [domain]);

  const toPct = useCallback(
    (ts: number) => ((ts - domain[0]) / span) * 100,
    [domain, span],
  );

  // One RGB compute per value yields both the fill and the text-contrast flag
  // (model is set wherever cells render).
  const cellAppearance = useCallback(
    (value: number) => {
      const rgb = heatmapColorRgb(
        spec.colorScheme,
        normalizeValue(value, model?.domain ?? [0, 1], spec.scaleType),
      );
      return {
        fill: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
        dark: isDarkColor(rgb),
      };
    },
    [spec.colorScheme, spec.scaleType, model?.domain],
  );

  const pxToTimestamp = useCallback(
    (clientX: number, rect: DOMRect) => {
      const ratio = Math.max(
        0,
        Math.min(1, (clientX - rect.left) / rect.width),
      );
      return domain[0] + ratio * span;
    },
    [domain, span],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      trackRectRef.current = rect;
      setBrushStart(pxToTimestamp(e.clientX, rect));
      setBrushEnd(null);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [pxToTimestamp],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (brushStart == null || !trackRectRef.current) return;
      setBrushEnd(pxToTimestamp(e.clientX, trackRectRef.current));
    },
    [brushStart, pxToTimestamp],
  );

  const handlePointerUp = useCallback(() => {
    if (brushStart != null && brushEnd != null) {
      const from = Math.min(brushStart, brushEnd);
      const to = Math.max(brushStart, brushEnd);
      if (to - from > 1000) {
        onTimeRangeChange({ from: new Date(from), to: new Date(to) });
      }
    }
    setBrushStart(null);
    setBrushEnd(null);
    trackRectRef.current = null;
  }, [brushStart, brushEnd, onTimeRangeChange]);

  if (!model || span <= 0 || model.cells.length === 0) {
    const message = !data
      ? "Configure a query to see results"
      : "No heatmap data in this time range";
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Grid3x3 className="size-8" />
        <p className="text-sm">{message}</p>
      </div>
    );
  }

  const { yBuckets, cells } = model;
  const [d0, d1] = model.domain;
  const gap = spec.cellGap;
  const cellsByBucket = yBuckets.map((_, b) =>
    cells.filter((c) => c.bucket === b),
  );

  return (
    <div className="flex h-full select-none flex-col overflow-hidden">
      {/* chart area — pointer interactions and the brush overlay cover the
          rows + axis but not the legend */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: chart interaction area */}
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onMouseMove={(e) =>
          setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))
        }
        onMouseLeave={() => setHover(null)}
      >
        {/* No overscroll-none here: rows usually fit, and a non-scrollable
            scroll container with overscroll-behavior:none swallows wheel
            events instead of letting the page scroll. */}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="flex h-full min-h-fit flex-col">
            {yBuckets.map((bucket, b) => (
              <div key={bucket} className="flex min-h-4 flex-1 items-stretch">
                <div
                  className="shrink-0 self-center truncate pr-2 text-right text-xs text-muted-foreground tabular-nums"
                  style={{ width: LABEL_WIDTH }}
                  title={bucket}
                >
                  {bucket}
                </div>
                <div className="relative min-w-0 flex-1 overflow-hidden">
                  {cellsByBucket[b]!.map((cell) => {
                    const { fill, dark } = cellAppearance(cell.value);
                    return (
                      // biome-ignore lint/a11y/noStaticElementInteractions: hover target for the tooltip
                      <div
                        key={cell.start}
                        className="absolute @container flex items-center justify-center overflow-hidden"
                        style={{
                          left: `calc(${toPct(cell.start)}% + ${gap / 2}px)`,
                          width: `calc(${toPct(cell.end) - toPct(cell.start)}% - ${gap}px)`,
                          minWidth: 1,
                          top: gap / 2,
                          height: `calc(100% - ${gap}px)`,
                          backgroundColor: fill,
                        }}
                        onMouseEnter={(e) =>
                          setHover({ bucket, cell, x: e.clientX, y: e.clientY })
                        }
                        onMouseLeave={() => setHover(null)}
                      >
                        {spec.showValues && (
                          // Container query: the value only renders once the
                          // cell is wide enough to fit a short number — narrow
                          // cells would otherwise show ellipsis specks.
                          <span
                            className="hidden @[2rem]:block truncate text-[10px] font-medium tabular-nums"
                            style={{ color: dark ? "white" : "black" }}
                          >
                            {formatValue(cell.value, spec.unit)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* time axis, aligned with the cell tracks */}
        <div className="flex h-5 shrink-0 items-start overflow-hidden">
          <div className="shrink-0" style={{ width: LABEL_WIDTH }} />
          <div ref={trackRef} className="relative min-w-0 flex-1">
            {ticks.map((tick) => (
              <span
                key={tick}
                className="-translate-x-1/2 absolute top-1 text-[10px] text-muted-foreground tabular-nums"
                style={{ left: `${toPct(tick)}%` }}
              >
                {formatTick(tick)}
              </span>
            ))}
          </div>
        </div>

        {brushStart != null && brushEnd != null && (
          <div
            className="pointer-events-none absolute inset-y-0 right-0 overflow-hidden"
            style={{ left: LABEL_WIDTH }}
          >
            <div
              className="absolute inset-y-0 border-x"
              style={{
                left: `${toPct(Math.min(brushStart, brushEnd))}%`,
                width: `${Math.abs(toPct(brushEnd) - toPct(brushStart))}%`,
                backgroundColor: BRUSH_COLOR,
                opacity: 0.15,
                borderColor: BRUSH_COLOR,
              }}
            />
          </div>
        )}
      </div>

      {spec.showLegend && (
        <div className="flex shrink-0 items-center justify-center gap-2 pt-1.5 text-xs">
          <span className="text-muted-foreground tabular-nums">
            {formatValue(d0, spec.unit)}
          </span>
          <span className="inline-block h-2.5 w-28 rounded-sm bg-muted align-middle">
            <span
              className="block h-full w-full rounded-sm"
              style={{
                // Sampled through the scale curve so the ramp matches the
                // actual cell fills under sqrt/log scales too.
                background: `linear-gradient(to right, ${[
                  0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1,
                ]
                  .map((p) => {
                    const v = d0 + p * (d1 - d0);
                    const t = normalizeValue(v, [d0, d1], spec.scaleType);
                    return `${heatmapColor(spec.colorScheme, t)} ${p * 100}%`;
                  })
                  .join(", ")})`,
              }}
            />
          </span>
          <span className="text-muted-foreground tabular-nums">
            {formatValue(d1, spec.unit)}
          </span>
        </div>
      )}

      {hover && (
        <CursorTooltip x={hover.x} y={hover.y}>
          <SeriesTooltipContent
            title={`${new Date(hover.cell.start).toLocaleString()} – ${new Date(hover.cell.end).toLocaleString()}`}
            rows={[
              {
                key: hover.bucket,
                color: cellAppearance(hover.cell.value).fill,
                label: hover.bucket,
                value: formatValue(hover.cell.value, spec.unit),
              },
            ]}
          />
        </CursorTooltip>
      )}
    </div>
  );
}
