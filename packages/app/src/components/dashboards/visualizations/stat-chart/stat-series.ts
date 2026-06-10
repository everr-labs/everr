import {
  detectTimeKey,
  getValueKeys,
  toNumber,
  toTimestamp,
} from "../data-utils";
import type { QueryResultRow } from "../index";
import { type CalculationType, calculate } from "./stat-calculations";

export interface StatTile {
  /** Index of the query (frame) this tile came from — stable tile identity. */
  frame: number;
  /** Column name; empty for a placeholder tile of a query with no data. */
  label: string;
  value: number | undefined;
  values: number[];
  points: { ts: number; value: number }[];
}

export function computeStatTiles(
  dataSets: QueryResultRow[][],
  calculation: CalculationType,
): StatTile[] {
  const tiles: StatTile[] = [];

  dataSets.forEach((rows, frame) => {
    const before = tiles.length;
    const first = rows[0];

    if (first) {
      const timeKey = detectTimeKey(rows);
      const valueKeys = getValueKeys(rows, timeKey ?? "");

      for (const valueKey of valueKeys) {
        if (!timeKey) {
          const values = rows
            .map((row) => toNumber(row[valueKey]))
            .filter((v): v is number => v !== null);
          tiles.push({
            frame,
            label: valueKey,
            value: calculate(values, calculation),
            values,
            points: [],
          });
          continue;
        }

        const points = rows
          .map((row) => ({
            ts: toTimestamp(row[timeKey]),
            value: toNumber(row[valueKey]),
          }))
          .filter(
            (p): p is { ts: number; value: number } =>
              p.value !== null && p.ts !== null,
          )
          .sort((a, b) => a.ts - b.ts);
        const values = points.map((p) => p.value);
        tiles.push({
          frame,
          label: valueKey,
          value: calculate(values, calculation),
          values,
          points,
        });
      }
    }

    // A query that yielded no tile (no rows, or no numeric column) still gets
    // a placeholder so its tile doesn't silently vanish from a multi-query
    // panel — the renderer shows the configured no-value text instead.
    if (tiles.length === before) {
      tiles.push({
        frame,
        label: "",
        value: undefined,
        values: [],
        points: [],
      });
    }
  });

  return tiles;
}
