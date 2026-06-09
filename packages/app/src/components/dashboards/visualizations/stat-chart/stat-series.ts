import {
  detectTimeKey,
  getValueKeys,
  toNumber,
  toTimestamp,
} from "../data-utils";
import type { QueryResultRow } from "../index";
import { type CalculationType, calculate } from "./stat-calculations";

export interface StatTile {
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

  for (const rows of dataSets) {
    const first = rows[0];
    if (!first) continue;

    const timeKey = detectTimeKey(rows);
    const valueKeys = getValueKeys(rows, timeKey ?? "");

    for (const valueKey of valueKeys) {
      if (!timeKey) {
        const values = rows
          .map((row) => toNumber(row[valueKey]))
          .filter((v): v is number => v !== null);
        tiles.push({
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
        .filter((p): p is { ts: number; value: number } => p.value !== null)
        .sort((a, b) => a.ts - b.ts);
      const values = points.map((p) => p.value);
      tiles.push({
        label: valueKey,
        value: calculate(values, calculation),
        values,
        points,
      });
    }
  }

  return tiles;
}
