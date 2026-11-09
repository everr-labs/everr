import { cn } from "@everr/ui/lib/utils";
import type { CSSProperties } from "react";

/** A 3px dash every 8px: round caps add half the stroke width to each end of
 * the 2px segment. */
const CURSOR_DASHES = "2 6";

/**
 * The dashed line that marks the instant under the pointer, spanning the box
 * `style` gives it (the parent must be positioned). Every time-based chart
 * draws its hover cursor with it. Each dash is outlined in the card color, so
 * it stays readable over colorful content like heatmap cells.
 */
export function CursorLine({
  horizontal = false,
  style,
}: {
  horizontal?: boolean;
  style: CSSProperties;
}) {
  // A 5px-wide strip centred on the line: the halo with its round caps fits
  // inside it.
  const line = horizontal
    ? { x1: 2, y1: 2.5, x2: "100%", y2: 2.5 }
    : { x1: 2.5, y1: 2, x2: 2.5, y2: "100%" };
  return (
    <svg
      aria-hidden
      data-slot="time-cursor"
      className={cn(
        "pointer-events-none absolute overflow-visible",
        horizontal ? "h-[5px] -translate-y-0.5" : "w-[5px] -translate-x-0.5",
      )}
      style={style}
    >
      <line
        {...line}
        stroke="var(--card)"
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={CURSOR_DASHES}
      />
      <line
        {...line}
        stroke="var(--foreground)"
        strokeWidth={1}
        strokeLinecap="round"
        strokeDasharray={CURSOR_DASHES}
      />
    </svg>
  );
}
