import type { SeriesTooltipRow } from "@everr/ui/components/series-tooltip";
import { useCallback, useState } from "react";
import { formatValue } from "@/data/alerting/triage/format";
import type {
  InstanceValuePoint,
  InstanceValueSeries,
} from "@/data/alerting/triage/view";

/** An evaluated value as the charts print it: the formatter's own rounding,
 *  falling back to the raw number when it has nothing to say about it. */
export function printValue(value: number) {
  return formatValue(value) ?? String(value);
}

/** The tones the alerting charts key their values with: the engine's own
 *  Condition verdict, not a per-series palette. */
export const BREACHING = "var(--destructive)";
export const QUIET = "var(--muted-foreground)";

/**
 * The line at the pointer, shared by both alerting charts.
 *
 * The line is what makes the tooltip trustworthy: it says which instant the
 * numbers belong to, which a card floating beside the pointer never does.
 * The parent must be positioned; the line spans its full height.
 */
export function ChartCrosshair({ left }: { left: number }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-y-0 w-px bg-foreground/55"
      style={{ left: `${left}%` }}
    />
  );
}

/**
 * The pointer gesture every alerting chart shares: scrub across the track, get
 * the instant under the cursor in minutes before the end of the window.
 *
 * The axis inversion and the clamp live here rather than in each chart because
 * `left` has to invert the same way `at` does. Two charts that disagreed by a
 * sign would draw the crosshair somewhere the tooltip is not describing.
 */
export function useChartScrub(windowMinutes: number) {
  const [hovered, setHovered] = useState<{
    at: number;
    clientX: number;
    clientY: number;
  } | null>(null);

  /** Ratio across the track, 0 at the oldest edge. For charts whose pointer
   *  target is not the element the crosshair is positioned against. */
  const scrubTo = useCallback(
    (ratio: number, clientX: number, clientY: number) =>
      setHovered({
        at: windowMinutes * (1 - Math.min(1, Math.max(0, ratio))),
        clientX,
        clientY,
      }),
    [windowMinutes],
  );

  const onMouseMove = useCallback(
    (event: React.MouseEvent) => {
      const box = event.currentTarget.getBoundingClientRect();
      scrubTo(
        (event.clientX - box.left) / box.width,
        event.clientX,
        event.clientY,
      );
    },
    [scrubTo],
  );

  const onMouseLeave = useCallback(() => setHovered(null), []);

  return {
    hovered,
    /** Percent across the track, for `ChartCrosshair`. */
    left: hovered ? ((windowMinutes - hovered.at) / windowMinutes) * 100 : 0,
    scrubTo,
    onMouseMove,
    onMouseLeave,
  };
}

/** The reading closest to an instant, which is the one the pointer is asking
 *  about: buckets are sparse, so the nearest is not the one it lands on. */
export function nearestPoint(
  points: InstanceValuePoint[],
  at: number,
  /** Ignore readings older than the window the chart is drawing. */
  within = Infinity,
) {
  let best: InstanceValuePoint | null = null;
  let distance = Infinity;
  for (const point of points) {
    if (point.at > within) continue;
    const gap = Math.abs(point.at - at);
    if (gap < distance) {
      best = point;
      distance = gap;
    }
  }
  return best;
}

/** Absolute clock time, the way every other chart tooltip in the app prints
 *  it. "3.0d ago" is the axis's unit, not a tooltip's: a responder comparing
 *  the chart against a log needs the time itself. */
export function tooltipTime(windowTo: number, minutesAgo: number) {
  return new Date(windowTo - minutesAgo * 60_000).toLocaleString();
}

/**
 * Every instance's value at one instant, as tooltip rows.
 *
 * All of them, not only the one under the pointer: reading one instance
 * against the others is the reason they share an axis at all. The swatch
 * carries the Condition verdict, so the row that crossed is findable without
 * comparing each number against the threshold by hand.
 */
export function instanceRowsAt(
  instances: InstanceValueSeries[],
  minutesAgo: number,
  windowMinutes: number,
): SeriesTooltipRow[] {
  return instances.map((instance) => {
    const nearest = nearestPoint(instance.points, minutesAgo, windowMinutes);
    return {
      key: instance.fingerprint,
      color: nearest?.breaching ? BREACHING : QUIET,
      label: instance.labels,
      value: nearest ? printValue(nearest.value) : "not evaluated",
      active: nearest?.breaching,
    };
  });
}
