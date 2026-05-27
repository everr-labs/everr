import { resolveTimeRange, type TimeRange } from "@everr/ui/lib/time-range";
import type { LogFilterOptions } from "../schemas";
import type { BuiltQuery } from "./explorer";
import { validateTableName } from "./table";

const REPOSITORY_RESOURCE_ATTRIBUTE = "vcs.repository.name";

function resourceAttribute(key: string): string {
  return `ResourceAttributes['${key}']`;
}

function resourceAttributeKeyExists(key: string): string {
  return `mapContains(ResourceAttributes, '${key}')`;
}

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
          SELECT DISTINCT ${resourceAttribute(REPOSITORY_RESOURCE_ATTRIBUTE)} AS v
          FROM ${tableName}
          WHERE TimestampTime >= parseDateTimeBestEffort({fromTime:String})
            AND TimestampTime <= parseDateTimeBestEffort({toTime:String})
            AND ${resourceAttributeKeyExists(REPOSITORY_RESOURCE_ATTRIBUTE)}
            AND ${resourceAttribute(REPOSITORY_RESOURCE_ATTRIBUTE)} != ''
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
