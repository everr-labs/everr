import { resolveTimeRange, type TimeRange } from "@everr/ui/lib/time-range";
import { validateTableName } from "../../sql/table";
import type { AttributeKey, AttributeSource } from "../schemas";
import type { BuiltQuery } from "./types";

// Cap each source independently so one high-cardinality map (e.g. log/span)
// can't fill a single global limit and crowd out keys from the others. Key
// names are low-cardinality in practice, so this effectively shows them all.
export const ATTRIBUTE_KEY_PER_SOURCE_LIMIT = 200;

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
    timeColumn?: string;
    // Extra boolean SQL ANDed into each source scan so discovery only sees the
    // same rows the domain's data queries do (e.g. errors restricts to
    // exception logs). Must be a static, param-free predicate.
    rowPredicate?: string;
  },
): BuiltQuery {
  validateTableName(opts.tableName);
  const timeColumn = opts.timeColumn ?? "TimestampTime";
  const scope = opts.rowPredicate
    ? `\n            AND (${opts.rowPredicate})`
    : "";
  const { fromISO, toISO } = resolveTimeRange(input.timeRange);
  const selects = opts.sources.map(
    (source) => `
        SELECT key, source FROM (
          SELECT DISTINCT arrayJoin(mapKeys(${opts.columnFor(source)})) AS key, '${source}' AS source
          FROM ${opts.tableName}
          WHERE ${timeColumn} >= parseDateTimeBestEffort({fromTime:String})
            AND ${timeColumn} <= parseDateTimeBestEffort({toTime:String})${scope}
        )
        WHERE key != ''
        ORDER BY key
        LIMIT ${ATTRIBUTE_KEY_PER_SOURCE_LIMIT}`,
  );
  const sql = `
      SELECT key, source FROM (
        ${selects.join("\n        UNION ALL\n")}
      )
      ORDER BY source, key
      `;
  return { sql, params: { fromTime: fromISO, toTime: toISO } };
}

export function decodeAttributeKeyRows(
  rows: AttributeKeyRowRaw[],
): AttributeKey[] {
  return rows.map((row) => ({ source: row.source, key: row.key }));
}
