import type {
  LogLevel,
  LogsTotalsInput,
  LogsTotalsResult,
} from "../schemas";
import { resolveTimeRange } from "../time-range";
import { LOG_LEVEL_EXPR, LOG_LEVELS } from "./level-expr";
import { validateTableName } from "./table";
import { buildWhereClause } from "./where";
import type { BuiltQuery } from "./explorer";

export type TotalsRowRaw = Record<LogLevel, string | number>;

export function buildTotalsQuery(
  input: LogsTotalsInput,
  opts: { tableName?: string } = {},
): BuiltQuery {
  const tableName = opts.tableName ?? "logs";
  validateTableName(tableName);
  const { fromISO, toISO } = resolveTimeRange(input.timeRange);
  const facetWhereClause = buildWhereClause({ ...input, includeLevels: false });
  const sql = `
      SELECT
        countIf(level = 'error') AS error,
        countIf(level = 'warning') AS warning,
        countIf(level = 'info') AS info,
        countIf(level = 'debug') AS debug,
        countIf(level = 'trace') AS trace,
        countIf(level = 'unknown') AS unknown
      FROM (
        SELECT ${LOG_LEVEL_EXPR} AS level
        FROM ${tableName}
        WHERE ${facetWhereClause}
      )
      `;
  return {
    sql,
    params: {
      fromTime: fromISO,
      toTime: toISO,
      query: input.query,
      levels: input.levels,
      services: input.services,
      repos: input.repos,
      traceId: input.traceId,
    },
  };
}

function emptyLevelCounts(): Record<LogLevel, number> {
  return { error: 0, warning: 0, info: 0, debug: 0, trace: 0, unknown: 0 };
}

export function decodeTotalsRows(
  rows: TotalsRowRaw[],
  selectedLevels: readonly LogLevel[],
): LogsTotalsResult {
  const row = rows[0];
  const levelCounts = emptyLevelCounts();
  if (row) {
    for (const level of LOG_LEVELS) {
      levelCounts[level] = Number(row[level] ?? 0);
    }
  }
  const effective = selectedLevels.length > 0 ? selectedLevels : LOG_LEVELS;
  const totalCount = effective.reduce((sum, level) => sum + levelCounts[level], 0);
  return { totalCount, levelCounts };
}
