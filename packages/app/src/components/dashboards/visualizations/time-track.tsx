import { type RefObject, useCallback, useState } from "react";
import { SERIES_COLORS } from "./data-utils";
import { type GridInsets, getPlotRect, type PlotRect, ratioWithin } from "./echarts/plot-rect";
import type { ResolvedTimeRange } from "./index";
import { CursorLine } from "@everr/ui/components/cursor-line";
import { usePointTimeCursor, useTimeCursor } from "./shared-time-cursor";

const BRUSH_COLOR = SERIES_COLORS[0];

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
 */
export function useTimeTrack<T>({
  chartElementRef,
  size,
  grid,
  domain,
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
  domain: [number, number];
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
  const timeAt = (clientX: number, plot: PlotRect) =>
    domain[0] + ratioWithin(clientX, plot.left, plot.width) * (domain[1] - domain[0]);
  const plotRect = () =>
    chartElementRef.current && grid ? getPlotRect(chartElementRef.current, grid) : null;

  const clearHover = useCallback(() => {
    setHover(null);
    clearCursor();
  }, [clearCursor]);

  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      const plot = ignore?.(e.target) ? null : plotRect();
      if (!plot) return;
      setDrag({ plot, from: timeAt(e.clientX, plot), to: null });
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (drag) setDrag({ ...drag, to: timeAt(e.clientX, drag.plot) });
    },
    onPointerUp: () => {
      if (drag?.to != null) {
        const from = Math.min(drag.from, drag.to);
        const to = Math.max(drag.from, drag.to);
        if (to - from > 1000) {
          setHover(null);
          onTimeRangeChange({ from: new Date(from), to: new Date(to) });
        }
      }
      setDrag(null);
    },
    onPointerCancel: () => setDrag(null),
    onMouseMove: (e: React.MouseEvent) => {
      const plot = ignore?.(e.target) ? null : plotRect();
      const x = plot ? (e.clientX - plot.left) / plot.width : -1;
      const y = plot ? (e.clientY - plot.top) / plot.height : -1;
      if (!plot || x < 0 || x > 1 || y < 0 || y > 1) return clearHover();
      const time = domain[0] + x * (domain[1] - domain[0]);
      const target = itemAt({ x, y, time, plot, clientY: e.clientY });
      setHover(target === null ? null : { target, x: e.clientX, y: e.clientY, size });
      setCursor(target !== null && cursorTime ? cursorTime(target) : time);
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
  domain,
  brush,
  plot,
}: {
  domain: [number, number];
  brush: [number, number] | null;
  plot: PlotRect;
}) {
  const cursor = useTimeCursor();
  const [start, end] = domain;
  const pct = (ts: number) => ((ts - start) / (end - start)) * 100;
  return (
    <div
      className="pointer-events-none absolute overflow-hidden"
      style={{ left: plot.left, top: plot.top, width: plot.width, height: plot.height }}
    >
      {cursor !== null && cursor >= start && cursor <= end && (
        <CursorLine style={{ left: `${pct(cursor)}%`, top: 0, height: "100%" }} />
      )}
      {brush && (
        <div
          className="absolute inset-y-0 border-x"
          style={{
            left: `${pct(brush[0])}%`,
            width: `${pct(brush[1]) - pct(brush[0])}%`,
            backgroundColor: BRUSH_COLOR,
            opacity: 0.15,
            borderColor: BRUSH_COLOR,
          }}
        />
      )}
    </div>
  );
}
