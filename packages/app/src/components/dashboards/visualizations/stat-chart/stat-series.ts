import { detectTimeKey, getValueKeys, toNumber, toTimestamp } from "../data-utils";
import type { QueryResultRow } from "../index";
import { type CalculationType, calculate } from "./stat-calculations";

export interface StatTile {
  /** Index of the query (frame) this tile came from — stable tile identity. */
  frame: number;
  /** Column name; empty for a placeholder tile of a query with no data. */
  label: string;
  value: number | undefined;
  /** Valid samples in time order. Without a time column, `ts` is the row
   * index — the values keep their query order, which is enough for a
   * sparkline. */
  points: { ts: number; value: number }[];
}

export function computeStatTiles(
  dataSets: QueryResultRow[][],
  calculation: CalculationType,
): StatTile[] {
  const tiles: StatTile[] = [];

  dataSets.forEach((rows, frame) => {
    const before = tiles.length;
    const timeKey = detectTimeKey(rows);

    for (const valueKey of getValueKeys(rows, timeKey ?? "")) {
      const points = rows
        .map((row, i) => ({
          ts: timeKey ? toTimestamp(row[timeKey]) : i,
          value: toNumber(row[valueKey]),
        }))
        .filter((p): p is { ts: number; value: number } => p.ts !== null && p.value !== null)
        .sort((a, b) => a.ts - b.ts);
      tiles.push({
        frame,
        label: valueKey,
        value: calculate(
          points.map((p) => p.value),
          calculation,
        ),
        points,
      });
    }

    // A query that yielded no tile (no rows, or no numeric column) still gets
    // a placeholder so its tile doesn't silently vanish from a multi-query
    // panel — the renderer shows the configured no-value text instead.
    if (tiles.length === before) {
      tiles.push({ frame, label: "", value: undefined, points: [] });
    }
  });

  return tiles;
}
