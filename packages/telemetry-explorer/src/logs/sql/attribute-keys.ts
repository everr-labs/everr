import { resolveTimeRange, type TimeRange } from "@everr/ui/lib/time-range";
import type { AttributeSource, LogAttributeKey } from "../schemas";
import { ATTRIBUTE_SOURCES, attributeColumn } from "./attribute-columns";
import type { BuiltQuery } from "./explorer";
import { validateTableName } from "./table";

const KEY_LIMIT = 500;

export interface AttributeKeyRowRaw {
  key: string;
  source: AttributeSource;
}

export function buildAttributeKeysQuery(
  input: { timeRange: TimeRange },
  opts: { tableName?: string } = {},
): BuiltQuery {
  const tableName = opts.tableName ?? "logs";
  validateTableName(tableName);
  const { fromISO, toISO } = resolveTimeRange(input.timeRange);
  const selects = ATTRIBUTE_SOURCES.map(
    (source) => `
        SELECT DISTINCT arrayJoin(mapKeys(${attributeColumn(source)})) AS key, '${source}' AS source
        FROM ${tableName}
        WHERE TimestampTime >= parseDateTimeBestEffort({fromTime:String})
          AND TimestampTime <= parseDateTimeBestEffort({toTime:String})`,
  );
  const sql = `
      SELECT key, source FROM (
        ${selects.join("\n        UNION ALL\n")}
      )
      WHERE key != ''
      ORDER BY source, key
      LIMIT ${KEY_LIMIT}
      `;
  return { sql, params: { fromTime: fromISO, toTime: toISO } };
}

export function decodeAttributeKeyRows(
  rows: AttributeKeyRowRaw[],
): LogAttributeKey[] {
  return rows.map((row) => ({ key: row.key, source: row.source }));
}
