export const MIN_PANEL_BUCKETS = 100;
export const MAX_PANEL_BUCKETS = 1000;

const SNAP = 100;

/**
 * The `{buckets}` count for a panel `widthPx` CSS pixels wide: one bucket per
 * pixel column, snapped up so a resize refetches only when it crosses a snap
 * point, held inside the bounds.
 */
export function bucketsForWidth(widthPx: number): number {
  const snapped = Math.ceil(widthPx / SNAP) * SNAP;
  return Math.min(MAX_PANEL_BUCKETS, Math.max(MIN_PANEL_BUCKETS, snapped));
}

/** Whether the SQL references the `{buckets:...}` parameter. */
export function usesBucketsParam(sql: string): boolean {
  return /\{\s*buckets\s*:/.test(sql);
}

/**
 * Seconds one bucket spans. Mirrors the width the docs give query authors,
 * `greatest(1, intDiv(to - from, {buckets:UInt32}))`, so the chart's gap floor
 * matches the buckets the query made.
 */
export function bucketWidthSeconds(from: Date, to: Date, buckets: number): number {
  return Math.max(1, Math.floor((to.getTime() - from.getTime()) / 1000 / buckets));
}
