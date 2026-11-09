import { CursorTooltip } from "@everr/ui/components/cursor-tooltip";
import { SeriesTooltipContent } from "@everr/ui/components/series-tooltip";
import { useEChart } from "@everr/ui/hooks/use-echart";
import { HeatmapChart, type HeatmapSeriesOption } from "echarts/charts";
import {
  type GridComponentOption,
  VisualMapContinuousComponent,
  type VisualMapComponentOption,
} from "echarts/components";
import * as echarts from "echarts/core";
import type { ComposeOption } from "echarts/core";
import { Grid3x3 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { normalizeValue } from "../color-scale";
import { generateTimeTicks } from "../data-utils";
import {
  axisLabelsWidth,
  createTextMeasurer,
  plainAxisOption,
  timeLabelFormatter,
} from "../echarts/axis";
import { type GridInsets, plotWithin, ratioWithin } from "../echarts/plot-rect";
import type { VisualizationProps } from "../index";
import { PanelEmptyState } from "../panel-empty-state";
import { TimeTrackOverlay, useTimeTrack } from "../time-track";
import { createValueFormatter } from "../value-format";
import { heatmapColor, heatmapColorRgb, heatmapSchemeColors, isDarkColor } from "./heatmap-colors";
import { buildHeatmapModel, type HeatmapCell } from "./heatmap-data";
import type { HeatmapSpec } from "./spec";

echarts.use([HeatmapChart, VisualMapContinuousComponent]);

type ChartOption = ComposeOption<
  HeatmapSeriesOption | GridComponentOption | VisualMapComponentOption
>;

/** Bucket labels wider than this truncate. */
const MAX_BUCKET_LABEL_WIDTH = 120;
/** Room under the plot for the time labels. */
const TIME_AXIS_HEIGHT = 22;
const TIME_LABELS = 6;
/** Columns narrower than this many gaps get no gap between them: it would
 * cover most of the cell. */
const MIN_GAPPED_COLUMN = 4;
const VALUE_FONT_SIZE = 10;
/** Rows shorter than this show no values. */
const VALUE_MIN_HEIGHT = 12;
/** Room kept clear on either side of a value inside its cell. */
const VALUE_PADDING = 6;

/** Nothing to do on resize: the hovered cell is looked up again on the next move. */
const ignoreResize = () => {};

export function HeatmapVisualization({
  spec,
  data,
  timeRange,
  onTimeRangeChange,
}: VisualizationProps<HeatmapSpec>) {
  const formatter = useMemo(() => createValueFormatter(spec.valueFormat), [spec.valueFormat]);
  const chartElementRef = useRef<HTMLDivElement>(null);

  const domain = useMemo<[number, number]>(
    () => [timeRange.from.getTime(), timeRange.to.getTime()],
    [timeRange],
  );
  const model = useMemo(
    () => (data ? buildHeatmapModel(data, spec, domain) : null),
    [data, spec, domain],
  );
  const hasChart = !!model && domain[1] > domain[0] && model.cells.length > 0;

  // The pointer maps onto the column grid, which can reach a little past the
  // time range on either side.
  const columns = model?.columns;
  const gridRange = useMemo<[number, number]>(
    () => (columns ? [columns.start, columns.start + columns.count * columns.step] : domain),
    [columns, domain],
  );
  const track = useTimeTrack<{ bucket: string; cell: HeatmapCell }>(gridRange, onTimeRangeChange);
  const { hover, hoverAt } = track;

  const mounted = useEChart(chartElementRef, hasChart, ignoreResize);
  const chart = mounted?.chart ?? null;
  const theme = mounted?.theme ?? null;

  const cellAppearance = useCallback(
    (value: number) => {
      const position = normalizeValue(value, model?.domain ?? [0, 1], spec.scaleType);
      const rgb = heatmapColorRgb(spec.colorScheme, position);
      return { position, fill: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`, dark: isDarkColor(rgb) };
    },
    [spec.colorScheme, spec.scaleType, model?.domain],
  );

  // Each cell's column and row, keyed for the hover lookup.
  const cellAt = useMemo(() => {
    const byKey = new Map<string, HeatmapCell>();
    if (!model) return { byKey, column: () => 0 };
    const { start, step, count } = model.columns;
    const column = (cell: HeatmapCell) =>
      Math.min(count - 1, Math.max(0, Math.floor((cell.start - start) / step)));
    for (const cell of model.cells) byKey.set(`${column(cell)}:${cell.bucket}`, cell);
    return { byKey, column };
  }, [model]);

  const grid = useMemo<GridInsets | null>(() => {
    if (!theme || !model) return null;
    const measure = createTextMeasurer(theme.fontFamily);
    return {
      left: Math.min(MAX_BUCKET_LABEL_WIDTH, axisLabelsWidth(model.yBuckets, measure)),
      right: 8,
      top: 4,
      bottom: TIME_AXIS_HEIGHT,
    };
  }, [theme, model]);

  useEffect(() => {
    if (!mounted || !grid || !model) return;
    const { chart, theme } = mounted;
    // After a hot reload this effect can still hold the replaced instance.
    if (chart.isDisposed()) return;
    const { start, step, count } = model.columns;
    const plot = plotWithin(chart, grid);
    const columnWidth = plot.width / count;
    // A value shows only where it fits its cell whole: clipped digits would
    // misread as a different number.
    const measureValue = createTextMeasurer(theme.fontFamily, VALUE_FONT_SIZE);
    const valueRoom =
      spec.showValues && plot.height / model.yBuckets.length >= VALUE_MIN_HEIGHT
        ? columnWidth - VALUE_PADDING
        : 0;
    // The gaps between cells are split lines in the panel color, drawn over
    // the cells (axes above the series): a border on every cell would cover
    // narrow columns almost entirely.
    const gap = (show: boolean) => ({
      z: 3,
      splitLine: {
        show: show && spec.cellGap > 0,
        interval: 0,
        lineStyle: { color: theme.cardColor, width: spec.cellGap },
      },
    });
    const formatTime = timeLabelFormatter(domain);
    const tickByColumn = new Map(
      generateTimeTicks(domain, TIME_LABELS).map((tick) => [
        Math.floor((tick - start) / step),
        tick,
      ]),
    );
    const plain = plainAxisOption(theme);
    const option: ChartOption = {
      animation: false,
      grid,
      xAxis: {
        type: "category",
        data: Array.from({ length: count }, (_, k) => String(k)),
        ...plain,
        ...gap(columnWidth >= MIN_GAPPED_COLUMN * spec.cellGap),
        // Labelled at the same round times as the other panels' time axes,
        // each on the column that contains it.
        axisLabel: {
          ...plain.axisLabel,
          interval: (k: number) => tickByColumn.has(k),
          formatter: (_: string, k: number) => {
            const tick = tickByColumn.get(k);
            return tick === undefined ? "" : formatTime(tick);
          },
        },
      },
      yAxis: {
        type: "category",
        data: model.yBuckets,
        inverse: true,
        ...plain,
        ...gap(true),
        axisLabel: {
          ...plain.axisLabel,
          width: MAX_BUCKET_LABEL_WIDTH - 16,
          overflow: "truncate",
        },
      },
      // Colors come from our own scale: each cell carries its position on it
      // (after linear, sqrt or log), and the map spreads the scheme over 0..1.
      visualMap: {
        type: "continuous",
        show: false,
        dimension: 2,
        min: 0,
        max: 1,
        inRange: { color: heatmapSchemeColors(spec.colorScheme) },
      },
      series: [
        {
          type: "heatmap",
          silent: true,
          progressive: 0,
          data: model.cells.map((cell) => {
            const { position, dark } = cellAppearance(cell.value);
            return {
              value: [cellAt.column(cell), cell.bucket, position, cell.value],
              label: {
                show: valueRoom > 0 && measureValue(formatter.format(cell.value)) <= valueRoom,
                color: dark ? "#fff" : "#000",
                fontSize: VALUE_FONT_SIZE,
                fontFamily: theme.fontFamily,
                formatter: () => formatter.format(cell.value),
              },
            };
          }),
        },
      ],
    };
    chart.setOption(option, { notMerge: true });
  }, [
    cellAppearance,
    cellAt,
    domain,
    formatter,
    grid,
    model,
    mounted,
    spec.cellGap,
    spec.colorScheme,
    spec.showValues,
  ]);

  if (!hasChart || !model) {
    return (
      <PanelEmptyState
        icon={Grid3x3}
        data={data}
        unusable="No row has a time inside this time range, a bucket and a numeric value."
      />
    );
  }

  // The cell under the pointer: a canvas has no element per cell to hover.
  const hoverCell = (e: React.MouseEvent) => {
    const element = chartElementRef.current;
    if (!element || !grid) return hoverAt(null, e);
    const box = element.getBoundingClientRect();
    const left = box.left + grid.left;
    const top = box.top + grid.top;
    const width = box.width - grid.left - grid.right;
    const height = box.height - grid.top - grid.bottom;
    if (e.clientX < left || e.clientX > left + width || e.clientY < top || e.clientY > top + height)
      return hoverAt(null, e);
    const { count } = model.columns;
    const column = Math.min(count - 1, Math.floor(ratioWithin(e.clientX, left, width) * count));
    const rows = model.yBuckets.length;
    const bucket = Math.min(rows - 1, Math.floor(ratioWithin(e.clientY, top, height) * rows));
    const cell = cellAt.byKey.get(`${column}:${bucket}`);
    hoverAt(cell ? { bucket: model.yBuckets[bucket] ?? "", cell } : null, e);
  };

  const plot = chart && grid ? plotWithin(chart, grid) : null;
  const [d0, d1] = model.domain;

  return (
    <div className="flex h-full select-none flex-col overflow-hidden">
      <div
        className="relative min-h-0 flex-1"
        {...track.handlers}
        onMouseMove={(e) => {
          track.handlers.onMouseMove(e);
          hoverCell(e);
        }}
      >
        {/* Hover is ours: ECharts would track the pointer too, forcing a layout per move. */}
        <div ref={chartElementRef} className="pointer-events-none h-full w-full" />
        {plot && (
          <div
            ref={track.trackRef}
            className="pointer-events-none absolute"
            style={{ left: plot.left, top: plot.top, width: plot.width, height: plot.height }}
          >
            <TimeTrackOverlay domain={gridRange} brush={track.brush} style={{ inset: 0 }} />
          </div>
        )}
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
            title={`${new Date(hover.target.cell.start).toLocaleString()} – ${new Date(hover.target.cell.end).toLocaleString()}`}
            rows={[
              {
                key: hover.target.bucket,
                color: cellAppearance(hover.target.cell.value).fill,
                label: hover.target.bucket,
                value: formatter.format(hover.target.cell.value),
              },
            ]}
          />
        </CursorTooltip>
      )}
    </div>
  );
}
