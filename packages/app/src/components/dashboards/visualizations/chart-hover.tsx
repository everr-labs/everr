// Shared hover calculations for the line charts.
/** Radius of a called-out marker. Also the tie distance, see below. */
const ACTIVE_R = 6;

const NONE: ReadonlySet<string> = new Set();

/**
 * Every series whose value is nearest the cursor. PLURAL, because the overlap
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
