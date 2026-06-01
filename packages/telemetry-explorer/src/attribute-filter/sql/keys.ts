import { resolveTimeRange, type TimeRange } from "@everr/ui/lib/time-range";
import { validateTableName } from "../../sql/table";
import type { AttributeKey, AttributeSource } from "../schemas";
import type { BuiltQuery } from "./types";

const KEY_LIMIT = 500;

export interface AttributeKeyRowRaw {
  key: string;
  source: AttributeSource;
}

export function buildAttributeKeysQuery(
  input: { timeRange: TimeRange },
  opts: {
    tableName: string;
    sources: AttributeSource[];
    columnFor: (source: AttributeSource) => string;
  },
): BuiltQuery {
  validateTableName(opts.tableName);
  const { fromISO, toISO } = resolveTimeRange(input.timeRange);
  const selects = opts.sources.map(
    (source) => `
        SELECT DISTINCT arrayJoin(mapKeys(${opts.columnFor(source)})) AS key, '${source}' AS source
        FROM ${opts.tableName}
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
): AttributeKey[] {
  return rows.map((row) => ({ source: row.source, key: row.key }));
}
