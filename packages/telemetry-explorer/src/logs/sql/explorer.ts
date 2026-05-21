import type { LogExplorerRow, LogLevel, LogsExplorerInput } from "../schemas";
import { resolveTimeRange } from "../time-range";
import { normalizeTimestampToUtc } from "../util/timestamp";
import { LOG_LEVEL_EXPR } from "./level-expr";
import { validateTableName } from "./table";
import { buildWhereClause } from "./where";

export interface ExplorerRowRaw {
  timestampRaw: string;
  level: LogLevel;
  body: string;
  traceId: string;
  spanId: string;
  serviceName: string;
  bodyHash: string;
}

export interface BuiltQuery {
  sql: string;
  params: Record<string, unknown>;
}

export function buildExplorerQuery(
  input: LogsExplorerInput,
  opts: { tableName?: string } = {},
): BuiltQuery {
  const tableName = opts.tableName ?? "logs";
  validateTableName(tableName);
  const { fromISO, toISO } = resolveTimeRange(input.timeRange);
  const whereClause = buildWhereClause(input);
  const sql = `
      SELECT
        Timestamp AS timestampRaw,
        ${LOG_LEVEL_EXPR} AS level,
        Body AS body,
        TraceId AS traceId,
        SpanId AS spanId,
        ServiceName AS serviceName,
        toString(cityHash64(Body)) AS bodyHash
      FROM ${tableName}
      WHERE ${whereClause}
      ORDER BY Timestamp DESC
      LIMIT {limit:UInt32}
      OFFSET {offset:UInt32}
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
      limit: input.limit,
      offset: input.offset,
    },
  };
}

export function mapExplorerRow(row: ExplorerRowRaw): LogExplorerRow {
  const identity = {
    timestampRaw: row.timestampRaw,
    traceId: row.traceId,
    spanId: row.spanId,
    serviceName: row.serviceName,
    bodyHash: row.bodyHash,
  };
  return {
    id: [
      row.timestampRaw,
      row.traceId,
      row.spanId,
      row.serviceName,
      row.bodyHash,
    ].join("|"),
    identity,
    timestamp: normalizeTimestampToUtc(row.timestampRaw),
    level: row.level,
    body: row.body,
  };
}
