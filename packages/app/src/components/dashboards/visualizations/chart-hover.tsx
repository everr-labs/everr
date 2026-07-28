// Shared hover behaviour for the line charts: the per-series markers drawn at
// the hovered instant, and the rule for which of them the pointer is actually
// pointing at.
//
// Both the dashboard time-series panel and the SLO budget chart draw one dot
// per series at the hovered x, ringed in the card colour so it separates from
// its line. Once several series can share a value — two SLO groups both at
// 100%, two dashboard series both at zero — an undifferentiated dot per series
// stops answering "which one is this", which is what `nearestSeriesKeys` and
// the emphasis below are for.
import type { ReactElement } from "react";
import { ReferenceDot } from "recharts";

/** Radius of a marker the pointer is not singling out. */
const PLAIN_R = 4;
/** Radius of a called-out marker. Also the tie distance, see below. */
const ACTIVE_R = 6;

const NONE: ReadonlySet<string> = new Set();

/**
 * Every series whose value is nearest the cursor — PLURAL, because the overlap
 * this exists to resolve is usually a tie. Two series plotting the same value
 * are equally near the pointer, and singling out one of them would be
 * arbitrary and would hide the other. Anything within `tolerance` of the
 * closest counts as tied too: at that distance the markers visibly overlap, so
 * the readout has to name them all.
 *
 * `tolerance` is in the same units as the values (use `markerTolerance` to get
 * it from a plot's geometry). Series with no value here are never nearest to
 * anything: a gap in a line is not a point to aim at.
 */
export function nearestSeriesKeys(
  points: readonly { key: string; value: number | null }[],
  cursorValue: number | null,
  tolerance: number,
): ReadonlySet<string> {
  if (cursorValue === null) return NONE;
  let nearest = Number.POSITIVE_INFINITY;
  for (const p of points) {
    if (p.value !== null) {
      nearest = Math.min(nearest, Math.abs(p.value - cursorValue));
    }
  }
  if (!Number.isFinite(nearest)) return NONE;
  const keys = new Set<string>();
  for (const p of points) {
    if (
      p.value !== null &&
      Math.abs(p.value - cursorValue) <= nearest + tolerance
    ) {
      keys.add(p.key);
    }
  }
  return keys;
}

/**
 * The tie distance for {@link nearestSeriesKeys}, in value units: markers
 * closer together than their own radius are touching on screen, so they are
 * called out together. Needs the plot's height in pixels and the value span it
 * covers.
 */
export function markerTolerance(plotHeightPx: number, valueSpan: number) {
  return plotHeightPx > 0 ? (ACTIVE_R / plotHeightPx) * valueSpan : 0;
}

/**
 * A cursor height, as a value on a linear y axis. Null when the geometry or
 * the pointer position is unknown, which reads downstream as "highlight
 * nothing" rather than as a wrong guess.
 */
export function valueAtCursorY(
  cursorY: number | null | undefined,
  plot: { top: number; height: number },
  domain: readonly [number, number],
): number | null {
  if (typeof cursorY !== "number" || plot.height <= 0) return null;
  const [min, max] = domain;
  return max - ((cursorY - plot.top) / plot.height) * (max - min);
}

/**
 * One marker per series at the hovered x, with the ones the pointer is nearest
 * enlarged. Returned as an array of elements rather than as a component: a
 * recharts chart only recognises reference shapes it can see among its own
 * children, so a wrapper component would be dropped silently.
 *
 * Called-out markers are emitted last so they paint over the plain ones —
 * without that, a highlighted point sharing a position with another would be
 * buried under it, which is the exact case the highlight exists for.
 */
export function hoverMarkers({
  x,
  points,
  activeKeys = NONE,
}: {
  /** The hovered x, in whatever the chart's x axis takes (instant or category). */
  x: number | string;
  points: readonly { key: string; value: number | null; color?: string }[];
  activeKeys?: ReadonlySet<string>;
}): ReactElement[] {
  return [...points]
    .sort(
      (a, b) => Number(activeKeys.has(a.key)) - Number(activeKeys.has(b.key)),
    )
    .flatMap((p) =>
      p.value === null
        ? []
        : [
            <ReferenceDot
              key={`hover-${p.key}`}
              x={x}
              y={p.value}
              r={activeKeys.has(p.key) ? ACTIVE_R : PLAIN_R}
              fill={p.color}
              // The card colour, not recharts' hardcoded white, which would
              // vanish against a light theme.
              stroke="var(--card)"
              strokeWidth={2}
              // Above the series AND any reference rules drawn over them.
              isFront
              // Never swallow a pointer heading for something underneath.
              style={{ pointerEvents: "none" }}
            />,
          ],
    );
}
