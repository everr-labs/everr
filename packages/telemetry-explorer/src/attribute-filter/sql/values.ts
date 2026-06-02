import { resolveTimeRange, type TimeRange } from "@everr/ui/lib/time-range";
import { validateTableName } from "../../sql/table";
import type { AttributeSource } from "../schemas";
import type { BuiltQuery } from "./types";

const VALUE_LIMIT = 100;

export interface AttributeValueRowRaw {
  v: string;
}

export function buildAttributeValuesQuery(
  input: {
    timeRange: TimeRange;
    source: AttributeSource;
    key: string;
    search?: string;
  },
  opts: {
    tableName: string;
    columnFor: (source: AttributeSource) => string;
    timeColumn?: string;
    // Parses a {param:String} time bound to the column's type. Defaults to
    // second precision; a DateTime64 table (e.g. traces) must pass the matching
    // parser so values don't disagree with the rows the data queries return.
    timeBound?: (param: string) => string;
    // Extra boolean SQL ANDed into the scan so discovery only sees the same
    // rows the domain's data queries do (e.g. errors restricts to exception
    // logs). Must be a static, param-free predicate.
    rowPredicate?: string;
  },
): BuiltQuery {
  validateTableName(opts.tableName);
  const timeColumn = opts.timeColumn ?? "TimestampTime";
  const timeBound =
    opts.timeBound ?? ((param) => `parseDateTimeBestEffort({${param}:String})`);
  const column = opts.columnFor(input.source);
  const { fromISO, toISO } = resolveTimeRange(input.timeRange);
  const params: Record<string, unknown> = {
    fromTime: fromISO,
    toTime: toISO,
    key: input.key,
  };
  const filters = [
    `${timeColumn} >= ${timeBound("fromTime")}`,
    `${timeColumn} <= ${timeBound("toTime")}`,
    `mapContains(${column}, {key:String})`,
    `${column}[{key:String}] != ''`,
  ];
  if (opts.rowPredicate) {
    filters.push(`(${opts.rowPredicate})`);
  }
  // Server-side substring match so high-cardinality values past the LIMIT
  // cutoff remain reachable — the user types and the matching slice is fetched.
  const search = input.search?.trim();
  if (search) {
    filters.push(
      `positionCaseInsensitive(${column}[{key:String}], {valueSearch:String}) > 0`,
    );
    params.valueSearch = search;
  }
  const sql = `
      SELECT DISTINCT ${column}[{key:String}] AS v
      FROM ${opts.tableName}
      WHERE ${filters.join("\n        AND ")}
      ORDER BY v
      LIMIT ${VALUE_LIMIT}
      `;
  return { sql, params };
}

export function decodeAttributeValueRows(
  rows: AttributeValueRowRaw[],
): string[] {
  return rows.map((row) => row.v);
}
