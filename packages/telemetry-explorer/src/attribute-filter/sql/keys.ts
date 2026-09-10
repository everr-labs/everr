import { resolveTimeRange, type TimeRange } from "@everr/ui/lib/time-range";
import { attributeKeysColumn } from "../../sql/json-attributes";
import { validateTableName } from "../../sql/table";
import type { AttributeKey, AttributeSource } from "../schemas";
import type { BuiltQuery } from "./types";

// Cap each source independently so one high-cardinality keys array (e.g.
// log/span) can't fill a single global limit and crowd out keys from the
// others. Key names are low-cardinality in practice, so this effectively
// shows them all. The keys array column costs only a few MiB per source to
// scan, since it holds distinct key names rather than the attribute values.
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
    // Parses a {param:String} time bound to the column's type. Defaults to
    // second precision; a DateTime64 table (e.g. traces) must pass the matching
    // parser so discovery doesn't drop sub-second rows the data queries keep.
    timeBound?: (param: string) => string;
    // Extra boolean SQL ANDed into each source scan so discovery only sees the
    // same rows the domain's data queries do (e.g. errors restricts to
    // exception logs). Must be a static, param-free predicate.
    rowPredicate?: string;
  },
): BuiltQuery {
  validateTableName(opts.tableName);
  const timeColumn = opts.timeColumn ?? "Timestamp";
  const timeBound =
    opts.timeBound ?? ((param) => `parseDateTimeBestEffort({${param}:String})`);
  const scope = opts.rowPredicate
    ? `\n            AND (${opts.rowPredicate})`
    : "";
  const { fromISO, toISO } = resolveTimeRange(input.timeRange);
  const selects = opts.sources.map(
    (source) => `
        SELECT key, source FROM (
          SELECT DISTINCT arrayJoin(${attributeKeysColumn(opts.columnFor(source))}) AS key, '${source}' AS source
          FROM ${opts.tableName}
          WHERE ${timeColumn} >= ${timeBound("fromTime")}
            AND ${timeColumn} <= ${timeBound("toTime")}${scope}
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
