import { ACCENT_COLOR } from "@everr/ui/lib/series-colors";
import { type PointerEvent, useState } from "react";

/**
 * For a chart that takes `useBrush`'s handlers: sideways drags belong to the
 * chart's readout, vertical swipes and pinches still to the page.
 */
export const TOUCH_SCRUB = "touch-pan-y touch-pinch-zoom";

/**
 * Drag to select a range along a chart's axis. A press that doesn't move
 * along the axis selects nothing. A finger reads the chart instead: touch
 * presses go to `onTouch`, and `onTouchCancel` runs when the page takes the
 * swipe to scroll. With `touchSelects`, a finger selects like a mouse, for a
 * chart that is waiting for a range.
 */
export function useBrush({
  positionAt,
  minSpan = 0,
  onSelect,
  onTouch,
  onTouchCancel,
  touchSelects = false,
}: {
  /** Null where a drag can't start; `clamped` keeps a drag past the plot's edge on it. */
  positionAt: (event: PointerEvent, clamped: boolean) => number | null;
  /** The narrowest range selected, in positions; any range is wider than 0. */
  minSpan?: number;
  onSelect: (from: number, to: number) => void;
  onTouch?: (event: PointerEvent) => void;
  onTouchCancel?: () => void;
  touchSelects?: boolean;
}) {
  const reads = (event: PointerEvent) => event.pointerType === "touch" && !touchSelects;
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);

  const span = drag ? Math.abs(drag.to - drag.from) : 0;
  const range: [number, number] | null =
    drag && span > 0 && span >= minSpan
      ? [Math.min(drag.from, drag.to), Math.max(drag.from, drag.to)]
      : null;

  const handlers = {
    onPointerDown: (event: PointerEvent) => {
      if (reads(event)) return onTouch?.(event);
      if (event.button !== 0) return;
      const from = positionAt(event, false);
      if (from === null) return;
      setDrag({ from, to: from });
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent) => {
      if (reads(event)) return onTouch?.(event);
      if (drag) setDrag({ ...drag, to: positionAt(event, true) ?? drag.to });
    },
    onPointerUp: () => {
      if (range) onSelect(...range);
      setDrag(null);
    },
    onPointerCancel: (event: PointerEvent) => {
      setDrag(null);
      if (event.pointerType === "touch") onTouchCancel?.();
    },
  };

  return { handlers, range, dragging: drag !== null };
}

/** A brush's selection; `start` and `size` are CSS lengths along the axis. */
export function BrushArea({
  vertical = false,
  start,
  size,
}: {
  vertical?: boolean;
  start: string | number;
  size: string | number;
}) {
  return (
    <div
      data-slot="brush-area"
      className={
        vertical
          ? "pointer-events-none absolute inset-x-0 border-y"
          : "pointer-events-none absolute inset-y-0 border-x"
      }
      style={{
        ...(vertical ? { top: start, height: size } : { left: start, width: size }),
        backgroundColor: ACCENT_COLOR,
        borderColor: ACCENT_COLOR,
        opacity: 0.15,
      }}
    />
  );
}
