import { detectTimeKey, getValueKeys, toTimestamp } from "../data-utils";
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
    const valueKeys = getValueKeys(first, timeKey ?? "");

    for (const valueKey of valueKeys) {
      if (!timeKey) {
        const values = rows
          .map((row) => row[valueKey])
          .filter((v): v is number => typeof v === "number");
        tiles.push({
          label: valueKey,
          value: calculate(values, calculation),
          values,
          points: [],
        });
        continue;
      }

      const points = rows
        .filter((row) => typeof row[valueKey] === "number")
        .map((row) => ({
          ts: toTimestamp(row[timeKey]),
          value: row[valueKey] as number,
        }))
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
