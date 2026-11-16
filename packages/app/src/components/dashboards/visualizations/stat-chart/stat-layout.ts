/** Narrowest a stat tile may get before the panel wraps it to another row. */
const STAT_TILE_MIN_WIDTH = 96;

/**
 * Columns for `tileCount` tiles in a panel `width` pixels wide. Uses as few
 * rows as fit, then spreads the tiles evenly across them, so 10 tiles that
 * fit 7 per row lay out 5 + 5 rather than 7 + 3. A width of 0 (not measured
 * yet) keeps every tile on one row.
 */
export function statColumns(tileCount: number, width: number): number {
  if (tileCount <= 1) return 1;
  if (width <= 0) return tileCount;
  const maxColumns = Math.max(1, Math.floor(width / STAT_TILE_MIN_WIDTH));
  const rows = Math.ceil(tileCount / maxColumns);
  return Math.ceil(tileCount / rows);
}
