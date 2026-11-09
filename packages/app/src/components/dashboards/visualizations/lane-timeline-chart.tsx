import { CursorTooltip } from "@everr/ui/components/cursor-tooltip";
import { SeriesTooltipContent } from "@everr/ui/components/series-tooltip";
import { resolveCssColor, useEChart } from "@everr/ui/hooks/use-echart";
import { readableForeground } from "@everr/ui/lib/contrast";
import { CustomChart, type CustomSeriesOption } from "echarts/charts";
import type { GridComponentOption } from "echarts/components";
import * as echarts from "echarts/core";
import type { ComposeOption } from "echarts/core";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { createTextMeasurer, rowLabelAxis, TIME_AXIS_HEIGHT, timeAxisOption } from "./echarts/axis";
import { gridOption, plotWithin } from "./echarts/plot-rect";
import type { ResolvedTimeRange } from "./index";
import { TimeTrackOverlay, useTimeTrack } from "./time-track";

echarts.use([CustomChart]);

type ChartOption = ComposeOption<CustomSeriesOption | GridComponentOption>;

/** Lanes never get shorter than this: past it, the lanes scroll. */
const MIN_LANE_HEIGHT = 24;
/** Items narrower than this still show, at this width. */
const MIN_ITEM_WIDTH = 2;
const VALUE_FONT_SIZE = 10;
/** Room kept clear on either side of a value inside its item. */
const VALUE_PADDING = 8;

export interface LaneTimelineItem {
  /** Item bounds in ms, already clamped to the domain. */
  start: number;
  end: number;
  state: string;
  /** Tooltip title — a time range (StateTimeline) or a single instant (StatusHistory). */
  title: string;
}

export interface LaneTimelineLane {
  label: string;
  /** In time order. */
  items: LaneTimelineItem[];
}

/** The item of `items` at `time`, or within `tolerance` ms of it. */
function laneItemAt(
  items: LaneTimelineItem[],
  time: number,
  tolerance: number,
): LaneTimelineItem | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item && item.start - tolerance <= time) return item.end + tolerance >= time ? item : null;
  }
  return null;
}

/**
 * Shared renderer for lane-of-colored-blocks timelines (StateTimeline,
 * StatusHistory). Owns the time axis, drag-to-zoom brush, legend and tooltip;
 * the caller supplies pre-positioned items per lane and the color map, so the
 * two charts differ only in how they build items (hold-until-next segments vs
 * fixed-width cells) and a couple of cosmetic props.
 */
export function LaneTimelineChart({
  lanes,
  states,
  colorByState,
  domain,
  rowHeight,
  showValues,
  showLegend,
  rounded = false,
  empty,
  onTimeRangeChange,
}: {
  lanes: LaneTimelineLane[];
  states: string[];
  colorByState: Record<string, string>;
  domain: [number, number];
  rowHeight: number;
  showValues: boolean;
  showLegend: boolean;
  /** Round item corners (StatusHistory cells). */
  rounded?: boolean;
  /** Shown instead of the chart when no lane has an item in the domain. */
  empty: ReactNode;
  onTimeRangeChange: (range: ResolvedTimeRange) => void;
}) {
  const chartElementRef = useRef<HTMLDivElement>(null);
  const span = domain[1] - domain[0];
  const hasChart = span > 0 && lanes.some((l) => l.items.length > 0);

  const mounted = useEChart(chartElementRef, hasChart);
  const theme = mounted?.theme ?? null;

  const labels = useMemo(() => lanes.map((lane) => lane.label), [lanes]);
  const yAxis = useMemo(() => (theme ? rowLabelAxis(theme, labels) : null), [theme, labels]);
  const grid = yAxis?.grid ?? null;

  const track = useTimeTrack({
    chartElementRef,
    size: mounted,
    grid,
    domain,
    onTimeRangeChange,
    itemAt: (at) => {
      const lane = lanes[Math.min(lanes.length - 1, Math.floor(at.y * lanes.length))];
      if (!lane) return null;
      const msPerPixel = span / at.plot.width;
      const item = laneItemAt(lane.items, at.time, msPerPixel * (MIN_ITEM_WIDTH / 2));
      return item ? { lane: lane.label, item } : null;
    },
  });
  const { hover } = track;

  useEffect(() => {
    if (!mounted || !grid || !yAxis) return;
    const { chart, theme } = mounted;
    const element = chartElementRef.current;
    const fills = states.map((state) => {
      const color = colorByState[state] ?? theme.textColor;
      return element ? resolveCssColor(element, color) : color;
    });
    // Blocks are opaque, so a value reads on the block color alone.
    const textFills = fills.map((fill) => readableForeground(fill)?.color ?? theme.foregroundColor);
    // A value shows only where it fits its item whole.
    const measure = createTextMeasurer(theme.fontFamily, VALUE_FONT_SIZE);
    const valueWidths = states.map((state) => measure(state) + VALUE_PADDING);
    const plot = plotWithin(mounted, grid);
    const laneHeight = (plot.height / lanes.length) * rowHeight;
    const option: ChartOption = {
      animation: false,
      grid: gridOption(grid),
      xAxis: timeAxisOption(theme, domain, plot.width),
      yAxis: yAxis.axis,
      series: [
        {
          type: "custom",
          silent: true,
          encode: { x: [1, 2], y: 0 },
          data: lanes.flatMap((lane, index) =>
            lane.items.map((item) => [index, item.start, item.end, states.indexOf(item.state)]),
          ),
          renderItem: (_, api) => {
            const lane = Number(api.value(0));
            const state = Number(api.value(3));
            const [x0 = 0, y = 0] = api.coord([api.value(1), lane]);
            const [x1 = 0] = api.coord([api.value(2), lane]);
            const rect = echarts.graphic.clipRectByRect(
              {
                x: x0,
                y: y - laneHeight / 2,
                width: Math.max(MIN_ITEM_WIDTH, x1 - x0),
                height: laneHeight,
              },
              { x: plot.left, y: plot.top, width: plot.width, height: plot.height },
            );
            if (!rect) return null;
            const fits = showValues && (valueWidths[state] ?? Infinity) <= rect.width;
            return {
              type: "rect",
              shape: { ...rect, r: rounded ? 2 : 0 },
              style: { fill: fills[state] },
              textContent: fits
                ? {
                    type: "text" as const,
                    style: {
                      text: states[state],
                      fill: textFills[state],
                      fontSize: VALUE_FONT_SIZE,
                      fontWeight: 500,
                      fontFamily: theme.fontFamily,
                    },
                  }
                : undefined,
              textConfig: { position: "inside" },
            };
          },
        },
      ],
    };
    chart.setOption(option, { notMerge: true });
  }, [colorByState, domain, grid, lanes, mounted, rounded, rowHeight, showValues, states, yAxis]);

  if (!hasChart) {
    return empty;
  }

  const plot = mounted && grid ? plotWithin(mounted, grid) : null;

  return (
    <div className="flex h-full select-none flex-col overflow-hidden text-muted-foreground">
      {/* No overscroll-none here: lanes usually fit, and a non-scrollable
          scroll container with overscroll-behavior:none swallows wheel
          events instead of letting the page scroll. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          data-slot="time-track"
          className="relative h-full"
          style={{ minHeight: lanes.length * MIN_LANE_HEIGHT + TIME_AXIS_HEIGHT }}
          {...track.handlers}
        >
          {/* Hover is ours: ECharts would track the pointer too, forcing a layout per move. */}
          <div ref={chartElementRef} className="pointer-events-none h-full w-full" />
          {plot && <TimeTrackOverlay domain={domain} brush={track.brush} plot={plot} />}
        </div>
      </div>

      {showLegend && states.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 pt-1.5 pb-3">
          {states.map((state) => (
            <div key={state} className="flex items-center gap-1.5 text-xs">
              <span
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: colorByState[state] }}
              />
              <span className="text-muted-foreground">{state}</span>
            </div>
          ))}
        </div>
      )}

      {hover && (
        <CursorTooltip x={hover.x} y={hover.y}>
          <SeriesTooltipContent
            title={hover.target.item.title}
            rows={[
              {
                key: hover.target.lane,
                color: colorByState[hover.target.item.state],
                label: hover.target.lane,
                value: hover.target.item.state,
              },
            ]}
          />
        </CursorTooltip>
      )}
    </div>
  );
}
