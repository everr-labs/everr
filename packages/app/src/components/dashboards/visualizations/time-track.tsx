import { memo, type RefObject, useMemo, useRef, useState } from "react";
import { createTimeTickFormatter, generateTimeTicks, SERIES_COLORS } from "./data-utils";
import { ratioWithin } from "./echarts/plot-rect";
import type { ResolvedTimeRange } from "./index";
import { CursorLine, usePointTimeCursor, useTimeCursor } from "./shared-time-cursor";

/** The row label gutter. The axis and the overlay start after it so they line
 * up with the tracks. */
export const TRACK_LABEL_WIDTH = 96;
const MAX_X_TICKS = 6;
const BRUSH_COLOR = SERIES_COLORS[0];

/**
 * The pointer behavior of panels drawn as labeled rows over the time range
 * (heatmap, state timeline, status history): drag across the tracks to zoom,
 * and point the dashboard's shared cursor while hovering them. Spread
 * `handlers` on the chart area and render `TimeTrackAxis` and
 * `TimeTrackOverlay` inside it.
 */
export function useTimeTrack(
  domain: [number, number],
  onTimeRangeChange: (range: ResolvedTimeRange) => void,
) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ rect: DOMRect; from: number; to: number | null } | null>(null);
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
      const rect = trackRef.current?.getBoundingClientRect();
      if (rect && rect.width > 0 && e.clientX >= rect.left && e.clientX <= rect.right) {
        setCursor(timeAt(e.clientX, rect));
      } else {
        clearCursor();
      }
    },
    onMouseLeave: clearCursor,
  };

  const brush: [number, number] | null =
    drag?.to != null ? [Math.min(drag.from, drag.to), Math.max(drag.from, drag.to)] : null;
  return { trackRef, handlers, brush };
}

/**
 * Whether the pointer left this element straight into another one with the
 * same `data-slot`. A hover moving from cell to cell then changes its target
 * without being cleared, which would unmount and remount its tooltip.
 */
export function leftForSibling(e: React.MouseEvent<HTMLElement>): boolean {
  const slot = e.currentTarget.dataset.slot;
  const next = e.relatedTarget;
  return !!slot && next instanceof Element && !!next.closest(`[data-slot="${slot}"]`);
}

/** Time labels under the tracks. `trackRef` measures the track width.
 * Memoized: the panel re-renders as its tooltip follows the pointer. */
export const TimeTrackAxis = memo(function TimeTrackAxis({
  domain,
  trackRef,
}: {
  domain: [number, number];
  trackRef: RefObject<HTMLDivElement | null>;
}) {
  const ticks = useMemo(() => generateTimeTicks(domain, MAX_X_TICKS), [domain]);
  const format = useMemo(() => createTimeTickFormatter(domain), [domain]);
  const span = domain[1] - domain[0];
  return (
    <div className="flex h-5 shrink-0 items-start overflow-hidden">
      <div className="shrink-0" style={{ width: TRACK_LABEL_WIDTH }} />
      <div ref={trackRef} className="relative min-w-0 flex-1">
        {ticks.map((tick) => (
          <span
            key={tick}
            className="-translate-x-1/2 absolute top-1 text-[10px] text-muted-foreground tabular-nums"
            style={{ left: `${((tick - domain[0]) / span) * 100}%` }}
          >
            {format(tick)}
          </span>
        ))}
      </div>
    </div>
  );
});

/** The drag selection and the shared cursor, over the tracks and the axis.
 * It reads the cursor itself, so a move redraws the line and not the rows. */
export function TimeTrackOverlay({
  domain,
  brush,
}: {
  domain: [number, number];
  brush: [number, number] | null;
}) {
  const cursor = useTimeCursor();
  const [start, end] = domain;
  const pct = (ts: number) => ((ts - start) / (end - start)) * 100;
  return (
    <div
      className="pointer-events-none absolute inset-y-0 right-0 overflow-hidden"
      style={{ left: TRACK_LABEL_WIDTH }}
    >
      {cursor !== null && cursor >= start && cursor <= end && (
        <CursorLine style={{ left: `${pct(cursor)}%`, top: 0, bottom: 0 }} />
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
