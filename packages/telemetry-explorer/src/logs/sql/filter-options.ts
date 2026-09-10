import { resolveTimeRange, type TimeRange } from "@everr/ui/lib/time-range";
import type { LogFilterOptions } from "../schemas";
import type { BuiltQuery } from "./explorer";
import { validateTableName } from "./table";

export interface FilterOptionsRowRaw {
  services: string[];
}

export function buildFilterOptionsQuery(
  input: { timeRange: TimeRange },
  opts: { tableName?: string } = {},
): BuiltQuery {
  const tableName = opts.tableName ?? "logs";
  validateTableName(tableName);
  const { fromISO, toISO } = resolveTimeRange(input.timeRange);
  const sql = `
      SELECT
        (SELECT groupArray(v) FROM (
          SELECT DISTINCT ServiceName AS v
          FROM ${tableName}
          WHERE Timestamp >= parseDateTimeBestEffort({fromTime:String})
            AND Timestamp <= parseDateTimeBestEffort({toTime:String})
            AND ServiceName != ''
          ORDER BY v
          LIMIT 100
        )) AS services
      `;
  return { sql, params: { fromTime: fromISO, toTime: toISO } };
}

export function decodeFilterOptionsRows(
  rows: FilterOptionsRowRaw[],
): LogFilterOptions {
  const row = rows[0];
  return { services: row?.services ?? [] };
}
