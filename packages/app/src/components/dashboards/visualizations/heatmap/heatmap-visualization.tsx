import { CursorTooltip } from "@everr/ui/components/cursor-tooltip";
import { ScrollArea } from "@everr/ui/components/scroll-area";
import { SeriesTooltipContent } from "@everr/ui/components/series-tooltip";
import { Grid3x3 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { normalizeValue } from "../color-scale";
import { TimeTrackAxis, TimeTrackOverlay, TRACK_LABEL_WIDTH, useTimeTrack } from "../time-track";
import type { VisualizationProps } from "../index";
import { createValueFormatter } from "../value-format";
import { heatmapColor, heatmapColorRgb, isDarkColor } from "./heatmap-colors";
import { buildHeatmapModel, type HeatmapCell } from "./heatmap-data";
import type { HeatmapSpec } from "./spec";
import { PanelEmptyState } from "../panel-empty-state";

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
  const formatter = useMemo(() => createValueFormatter(spec.valueFormat), [spec.valueFormat]);
  const [hover, setHover] = useState<HoverState | null>(null);

  const domain = useMemo<[number, number]>(
    () => [timeRange.from.getTime(), timeRange.to.getTime()],
    [timeRange],
  );
  const track = useTimeTrack(domain, onTimeRangeChange);
  const span = domain[1] - domain[0];

  const model = useMemo(
    () => (data ? buildHeatmapModel(data, spec, domain) : null),
    [data, spec, domain],
  );

  const toPct = useCallback((ts: number) => ((ts - domain[0]) / span) * 100, [domain, span]);

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

  // The cells follow the data, not the pointer: hovering only moves the
  // tooltip, so the cells are built once per result.
  const rows = useMemo(() => {
    if (!model) return null;
    const gap = spec.cellGap;
    const cellsByBucket = model.yBuckets.map((_, b) => model.cells.filter((c) => c.bucket === b));
    return (
      <div className="flex h-full min-h-fit flex-col">
        {model.yBuckets.map((bucket, b) => (
          <div key={bucket} className="flex min-h-4 flex-1 items-stretch">
            <div
              className="shrink-0 self-center truncate pr-2 text-right text-xs text-muted-foreground tabular-nums"
              style={{ width: TRACK_LABEL_WIDTH }}
              title={bucket}
            >
              {bucket}
            </div>
            <div className="relative min-w-0 flex-1 overflow-hidden">
              {cellsByBucket[b].map((cell) => {
                const { fill, dark } = cellAppearance(cell.value);
                return (
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
                    onMouseEnter={(e) => setHover({ bucket, cell, x: e.clientX, y: e.clientY })}
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
                        {formatter.format(cell.value)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }, [model, spec.cellGap, spec.showValues, cellAppearance, toPct, formatter]);

  if (!model || span <= 0 || model.cells.length === 0) {
    return (
      <PanelEmptyState
        icon={Grid3x3}
        data={data}
        unusable="No row has a time inside this time range, a bucket and a numeric value."
      />
    );
  }

  const [d0, d1] = model.domain;

  return (
    <div className="flex h-full select-none flex-col overflow-hidden">
      {/* chart area — pointer interactions and the brush overlay cover the
          rows + axis but not the legend */}
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        {...track.handlers}
        onMouseMove={(e) => {
          track.handlers.onMouseMove(e);
          setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h));
        }}
        onMouseLeave={() => {
          track.handlers.onMouseLeave();
          setHover(null);
        }}
      >
        {/* No overscroll-none here: rows usually fit, and a non-scrollable
            scroll container with overscroll-behavior:none swallows wheel
            events instead of letting the page scroll. */}
        <ScrollArea className="min-h-0 flex-1">{rows}</ScrollArea>

        <TimeTrackAxis domain={domain} trackRef={track.trackRef} />
        <TimeTrackOverlay domain={domain} brush={track.brush} />
      </div>

      {spec.showLegend && (
        <div className="flex shrink-0 items-center justify-center gap-2 pt-1.5 text-xs">
          <span className="text-muted-foreground tabular-nums">{formatter.format(d0)}</span>
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
          <span className="text-muted-foreground tabular-nums">{formatter.format(d1)}</span>
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
                value: formatter.format(hover.cell.value),
              },
            ]}
          />
        </CursorTooltip>
      )}
    </div>
  );
}
