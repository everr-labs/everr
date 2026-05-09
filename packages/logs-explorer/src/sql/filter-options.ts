import type { LogFilterOptions } from "../schemas";
import { resolveTimeRange, type TimeRange } from "../time-range";
import { validateTableName } from "./table";
import type { BuiltQuery } from "./explorer";

export interface FilterOptionsRowRaw {
  services: string[];
  repos: string[];
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
          WHERE TimestampTime >= parseDateTimeBestEffort({fromTime:String})
            AND TimestampTime <= parseDateTimeBestEffort({toTime:String})
            AND ServiceName != ''
          ORDER BY v
          LIMIT 100
        )) AS services,
        (SELECT groupArray(v) FROM (
          SELECT DISTINCT ResourceAttributes['vcs.repository.name'] AS v
          FROM ${tableName}
          WHERE TimestampTime >= parseDateTimeBestEffort({fromTime:String})
            AND TimestampTime <= parseDateTimeBestEffort({toTime:String})
            AND ResourceAttributes['vcs.repository.name'] != ''
          ORDER BY v
          LIMIT 100
        )) AS repos
      `;
  return { sql, params: { fromTime: fromISO, toTime: toISO } };
}

export function decodeFilterOptionsRows(
  rows: FilterOptionsRowRaw[],
): LogFilterOptions {
  const row = rows[0];
  return { services: row?.services ?? [], repos: row?.repos ?? [] };
}
