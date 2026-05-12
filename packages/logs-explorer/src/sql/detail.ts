import type { LogDetail, LogIdentity, LogLevel } from "../schemas";
import { normalizeTimestampToUtc } from "../util/timestamp";
import { LOG_LEVEL_EXPR } from "./level-expr";
import { validateTableName } from "./table";
import type { BuiltQuery } from "./explorer";

export interface DetailRowRaw {
  timestampRaw: string;
  level: LogLevel;
  severityText: string;
  severityNumber: string | number;
  serviceName: string;
  traceId: string;
  spanId: string;
  resourceAttributes: Record<string, string> | null;
  logAttributes: Record<string, string> | null;
  scopeAttributes: Record<string, string> | null;
}

export function buildDetailQuery(
  identity: LogIdentity,
  opts: { tableName?: string } = {},
): BuiltQuery {
  const tableName = opts.tableName ?? "logs";
  validateTableName(tableName);
  const sql = `
      SELECT
        Timestamp AS timestampRaw,
        ${LOG_LEVEL_EXPR} AS level,
        SeverityText AS severityText,
        SeverityNumber AS severityNumber,
        ServiceName AS serviceName,
        TraceId AS traceId,
        SpanId AS spanId,
        ResourceAttributes AS resourceAttributes,
        LogAttributes AS logAttributes,
        ScopeAttributes AS scopeAttributes
      FROM ${tableName}
      WHERE TimestampTime = toDateTime(parseDateTime64BestEffort({timestampRaw:String}, 9))
        AND Timestamp = parseDateTime64BestEffort({timestampRaw:String}, 9)
        AND ServiceName = {serviceName:String}
        AND TraceId = {traceId:String}
        AND SpanId = {spanId:String}
        AND toString(cityHash64(Body)) = {bodyHash:String}
      LIMIT 1
      `;
  return { sql, params: { ...identity } };
}

export function mapDetailRow(row: DetailRowRaw): LogDetail {
  return {
    timestamp: normalizeTimestampToUtc(row.timestampRaw),
    level: row.level,
    severityText: row.severityText,
    severityNumber: Number(row.severityNumber),
    serviceName: row.serviceName,
    traceId: row.traceId,
    spanId: row.spanId,
    resourceAttributes: row.resourceAttributes ?? {},
    logAttributes: row.logAttributes ?? {},
    scopeAttributes: row.scopeAttributes ?? {},
  };
}
