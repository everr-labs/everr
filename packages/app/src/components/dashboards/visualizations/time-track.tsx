import { CursorLine } from "@everr/ui/components/cursor-line";
import type { ChartTheme } from "@everr/ui/hooks/use-echart";
import { type RefObject, useCallback, useState } from "react";
import { SERIES_COLORS } from "./data-utils";
import { TIME_AXIS_HEIGHT, timeAxisTicks } from "./echarts/axis";
import { type GridInsets, getPlotRect, type PlotRect, ratioWithin } from "./echarts/plot-rect";
import type { ResolvedTimeRange } from "./index";
import { usePointTimeCursor, useTimeCursor } from "./shared-time-cursor";

const BRUSH_COLOR = SERIES_COLORS[0];

/** Where instants fall along a plot's time axis, as a 0..1 share of it. */
export interface TimeScale {
  timeAt: (ratio: number) => number;
  /** Null for an instant the plot doesn't show, e.g. in a skipped bucket. */
  ratioAt: (time: number) => number | null;
}

/** A time axis spread evenly over `domain`. */
export function linearTimeScale([start, end]: [number, number]): TimeScale {
  return {
    timeAt: (ratio) => start + ratio * (end - start),
    ratioAt: (time) => (time - start) / (end - start),
  };
}

/** The pointer over a plot: where across it (each axis 0..1), the instant
 * under it, and the plot's rect in client coordinates. */
export interface PlotPointer {
  x: number;
  y: number;
  time: number;
  plot: PlotRect;
  clientY: number;
}

/**
 * The pointer behavior of a panel drawn over the time range: drag across the
 * plot to zoom, point the dashboard's shared cursor, and track the hovered
 * item for its tooltip. `itemAt` finds the item under the pointer, since a
 * canvas has no element per item to hover. Spread `handlers` on the chart
 * area and render `TimeTrackOverlay` over the plot.
 *
 * Without a `scale` (bars over categories) only the hover is tracked.
 */
export function useTimeTrack<T>({
  chartElementRef,
  size,
  grid,
  scale,
  vertical = false,
  onTimeRangeChange,
  itemAt,
  cursorTime,
  ignore,
}: {
  chartElementRef: RefObject<HTMLElement | null>;
  /** The chart's size: a resize drops the hover, whose tooltip sits where
   * the pointer was over the old layout. */
  size: { width: number; height: number } | null;
  grid: GridInsets | null;
  scale: TimeScale | null;
  /** Time runs down the plot rather than across it (horizontal bars). */
  vertical?: boolean;
  onTimeRangeChange: (range: ResolvedTimeRange) => void;
  itemAt: (at: PlotPointer) => T | null;
  /** The instant the shared cursor marks for an item; by default the pointer's. */
  cursorTime?: (item: T) => number;
  /** Parts of the chart area the pointer does nothing over, e.g. a legend. */
  ignore?: (target: EventTarget) => boolean;
}) {
  const [drag, setDrag] = useState<{ plot: PlotRect; from: number; to: number | null } | null>(
    null,
  );
  const [hover, setHover] = useState<{
    target: T;
    x: number;
    y: number;
    size: { width: number; height: number } | null;
  } | null>(null);
  const { set: setCursor, clear: clearCursor } = usePointTimeCursor();

  /** The pointer's share of the plot along each axis, unclamped. */
  const pointerAt = (e: React.MouseEvent, plot: PlotRect) => ({
    x: (e.clientX - plot.left) / plot.width,
    y: (e.clientY - plot.top) / plot.height,
  });
  const inPlot = ({ x, y }: { x: number; y: number }) => x >= 0 && x <= 1 && y >= 0 && y <= 1;
  /** The instant under the pointer, at the plot's edge once it is past it. */
  const timeAt = (e: React.MouseEvent, plot: PlotRect) =>
    scale?.timeAt(
      vertical
        ? ratioWithin(e.clientY, plot.top, plot.height)
        : ratioWithin(e.clientX, plot.left, plot.width),
    ) ?? 0;
  const plotRect = (e: React.MouseEvent) =>
    !ignore?.(e.target) && chartElementRef.current && grid
      ? getPlotRect(chartElementRef.current, grid)
      : null;

  const clearHover = useCallback(() => {
    setHover(null);
    clearCursor();
  }, [clearCursor]);

  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      const plot = plotRect(e);
      if (!scale || !plot || e.button !== 0 || !inPlot(pointerAt(e, plot))) return;
      setDrag({ plot, from: timeAt(e, plot), to: null });
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (drag) setDrag({ ...drag, to: timeAt(e, drag.plot) });
    },
    onPointerUp: () => {
      if (drag?.to != null) {
        const from = Math.min(drag.from, drag.to);
        const to = Math.max(drag.from, drag.to);
        if (to - from > 1000) {
          clearHover();
          onTimeRangeChange({ from: new Date(from), to: new Date(to) });
        }
      }
      setDrag(null);
    },
    onPointerCancel: () => setDrag(null),
    onMouseMove: (e: React.MouseEvent) => {
      const plot = plotRect(e);
      const at = plot && pointerAt(e, plot);
      if (!plot || !at || !inPlot(at)) return clearHover();
      const time = scale?.timeAt(vertical ? at.y : at.x) ?? 0;
      const target = itemAt({ ...at, time, plot, clientY: e.clientY });
      setHover(target === null ? null : { target, x: e.clientX, y: e.clientY, size });
      if (scale) setCursor(target !== null && cursorTime ? cursorTime(target) : time);
    },
    onMouseLeave: clearHover,
  };

  const brush: [number, number] | null =
    drag?.to != null ? [Math.min(drag.from, drag.to), Math.max(drag.from, drag.to)] : null;
  const current =
    hover?.size?.width === size?.width && hover?.size?.height === size?.height ? hover : null;
  return { handlers, hover: current, clearHover, brush };
}

/** The drag selection and the shared cursor, laid over `plot` (in the chart
 * element's coordinates). It reads the cursor itself, so a move redraws the
 * line and not the chart. */
export function TimeTrackOverlay({
  scale,
  vertical = false,
  brush,
  plot,
}: {
  scale: TimeScale;
  vertical?: boolean;
  brush: [number, number] | null;
  plot: PlotRect;
}) {
  const cursor = useTimeCursor();
  const at = cursor === null ? null : scale.ratioAt(cursor);
  const from = brush && scale.ratioAt(brush[0]);
  const to = brush && scale.ratioAt(brush[1]);
  const pct = (ratio: number) => `${ratio * 100}%`;
  return (
    <div
      className="pointer-events-none absolute overflow-hidden"
      style={{ left: plot.left, top: plot.top, width: plot.width, height: plot.height }}
    >
      {at !== null && at >= 0 && at <= 1 && (
        <CursorLine
          horizontal={vertical}
          style={
            vertical
              ? { top: pct(at), left: 0, width: "100%" }
              : { left: pct(at), top: 0, height: "100%" }
          }
        />
      )}
      {from != null && to != null && (
        <div
          className={vertical ? "absolute inset-x-0 border-y" : "absolute inset-y-0 border-x"}
          style={{
            ...(vertical
              ? { top: pct(from), height: pct(to - from) }
              : { left: pct(from), width: pct(to - from) }),
            backgroundColor: BRUSH_COLOR,
            opacity: 0.15,
            borderColor: BRUSH_COLOR,
          }}
        />
      )}
    </div>
  );
}

/**
 * A time axis drawn under a chart rather than in it, for charts whose rows
 * scroll: it stays in view however far they do. Labels the same round times
 * as every other time axis over `domain`, placed by `scale` (a heatmap's
 * column grid can run past the range).
 */
export function TimeAxis({
  theme,
  domain,
  scale,
  plot,
}: {
  theme: ChartTheme;
  domain: [number, number];
  scale: TimeScale;
  plot: PlotRect;
}) {
  // How wide the range itself is on the plot, for the labels' room before
  // its end.
  const width = ((scale.ratioAt(domain[1]) ?? 1) - (scale.ratioAt(domain[0]) ?? 0)) * plot.width;
  const { ticks, format } = timeAxisTicks(theme, domain, width);
  return (
    <div className="relative shrink-0 overflow-hidden text-xs" style={{ height: TIME_AXIS_HEIGHT }}>
      {ticks.map((tick) => (
        <span
          key={tick}
          className="absolute top-1 -translate-x-1/2 whitespace-nowrap"
          style={{ left: plot.left + (scale.ratioAt(tick) ?? 0) * plot.width }}
        >
          {format(tick)}
        </span>
      ))}
    </div>
  );
}
