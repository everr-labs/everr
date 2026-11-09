import { type RefObject, useRef, useState } from "react";
import { SERIES_COLORS } from "./data-utils";
import { type PlotRect, ratioWithin } from "./echarts/plot-rect";
import type { ResolvedTimeRange } from "./index";
import { CursorLine } from "@everr/ui/components/cursor-line";
import { usePointTimeCursor, useTimeCursor } from "./shared-time-cursor";

const BRUSH_COLOR = SERIES_COLORS[0];

/**
 * The pointer behavior of canvas panels drawn as rows over the time range
 * (heatmap, state timeline, status history): drag across the plot to zoom,
 * point the dashboard's shared cursor, and track the hovered item for its
 * tooltip. `itemAt` finds the item under the pointer: a canvas has no element
 * per item to hover. Spread `handlers` on the chart area and render
 * `TimeTrackOverlay` over the plot.
 */
export function useTimeTrack<T>(
  domain: [number, number],
  onTimeRangeChange: (range: ResolvedTimeRange) => void,
  itemAt: (e: React.MouseEvent) => T | null,
) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ rect: DOMRect; from: number; to: number | null } | null>(null);
  const [hover, setHover] = useState<{ target: T; x: number; y: number } | null>(null);
  const { set: setCursor, clear: clearCursor } = usePointTimeCursor();
  const timeAt = (clientX: number, rect: DOMRect) =>
    domain[0] + ratioWithin(clientX, rect.left, rect.width) * (domain[1] - domain[0]);

  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      setDrag({ rect, from: timeAt(e.clientX, rect), to: null });
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (drag) setDrag({ ...drag, to: timeAt(e.clientX, drag.rect) });
    },
    onPointerUp: () => {
      if (drag?.to != null) {
        const from = Math.min(drag.from, drag.to);
        const to = Math.max(drag.from, drag.to);
        if (to - from > 1000) onTimeRangeChange({ from: new Date(from), to: new Date(to) });
      }
      setDrag(null);
    },
    onMouseMove: (e: React.MouseEvent) => {
      const target = itemAt(e);
      setHover(target === null ? null : { target, x: e.clientX, y: e.clientY });
      const rect = trackRef.current?.getBoundingClientRect();
      if (rect && rect.width > 0 && e.clientX >= rect.left && e.clientX <= rect.right) {
        setCursor(timeAt(e.clientX, rect));
      } else {
        clearCursor();
      }
    },
    onMouseLeave: () => {
      setHover(null);
      clearCursor();
    },
  };

  const brush: [number, number] | null =
    drag?.to != null ? [Math.min(drag.from, drag.to), Math.max(drag.from, drag.to)] : null;
  return { trackRef, handlers, hover, brush };
}

/** The drag selection and the shared cursor, laid over `plot`. `trackRef`
 * measures the plot for the pointer. It reads the cursor itself, so a move
 * redraws the line and not the chart. */
export function TimeTrackOverlay({
  domain,
  brush,
  plot,
  trackRef,
}: {
  domain: [number, number];
  brush: [number, number] | null;
  plot: PlotRect;
  trackRef: RefObject<HTMLDivElement | null>;
}) {
  const cursor = useTimeCursor();
  const [start, end] = domain;
  const pct = (ts: number) => ((ts - start) / (end - start)) * 100;
  return (
    <div
      ref={trackRef}
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
