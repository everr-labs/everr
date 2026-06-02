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
  },
): BuiltQuery {
  validateTableName(opts.tableName);
  const timeColumn = opts.timeColumn ?? "TimestampTime";
  const column = opts.columnFor(input.source);
  const { fromISO, toISO } = resolveTimeRange(input.timeRange);
  const params: Record<string, unknown> = {
    fromTime: fromISO,
    toTime: toISO,
    key: input.key,
  };
  const filters = [
    `${timeColumn} >= parseDateTimeBestEffort({fromTime:String})`,
    `${timeColumn} <= parseDateTimeBestEffort({toTime:String})`,
    `mapContains(${column}, {key:String})`,
    `${column}[{key:String}] != ''`,
  ];
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
