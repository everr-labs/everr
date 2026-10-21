import { LogLevelSchema } from "../schemas";
import { z } from "zod";
import { SqlAttributesSchema, SqlCountSchema, SqlTimestampSchema } from "../../sql/row-schemas";
import { flattenAttributes } from "../../sql/json-attributes";
import type { LogDetail, LogIdentity } from "../schemas";
import { normalizeTimestampToUtc } from "../util/timestamp";
import type { BuiltQuery } from "./explorer";
import { LOG_LEVEL_EXPR } from "./level-expr";
import { validateTableName } from "./table";

export const DetailRowRawSchema = z.object({
  timestampRaw: SqlTimestampSchema,
  level: LogLevelSchema,
  severityText: z.string(),
  severityNumber: SqlCountSchema,
  serviceName: z.string(),
  traceId: z.string(),
  spanId: z.string(),
  resourceAttributes: SqlAttributesSchema,
  logAttributes: SqlAttributesSchema,
  scopeAttributes: SqlAttributesSchema,
});
export type DetailRowRaw = z.infer<typeof DetailRowRawSchema>;

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
      WHERE Timestamp = parseDateTime64BestEffort({timestampRaw:String}, 9)
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
    resourceAttributes: flattenAttributes(row.resourceAttributes),
    logAttributes: flattenAttributes(row.logAttributes),
    scopeAttributes: flattenAttributes(row.scopeAttributes),
  };
}
