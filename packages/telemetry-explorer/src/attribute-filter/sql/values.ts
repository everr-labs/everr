import { resolveTimeRange, type TimeRange } from "@everr/ui/lib/time-range";
import { validateTableName } from "../../sql/table";
import type { AttributeSource } from "../schemas";
import type { BuiltQuery } from "./types";

const VALUE_LIMIT = 100;

export interface AttributeValueRowRaw {
  v: string;
}

export function buildAttributeValuesQuery(
  input: { timeRange: TimeRange; source: AttributeSource; key: string },
  opts: { tableName: string; columnFor: (source: AttributeSource) => string },
): BuiltQuery {
  validateTableName(opts.tableName);
  const column = opts.columnFor(input.source);
  const { fromISO, toISO } = resolveTimeRange(input.timeRange);
  const sql = `
      SELECT DISTINCT ${column}[{key:String}] AS v
      FROM ${opts.tableName}
      WHERE TimestampTime >= parseDateTimeBestEffort({fromTime:String})
        AND TimestampTime <= parseDateTimeBestEffort({toTime:String})
        AND mapContains(${column}, {key:String})
        AND ${column}[{key:String}] != ''
      ORDER BY v
      LIMIT ${VALUE_LIMIT}
      `;
  return { sql, params: { fromTime: fromISO, toTime: toISO, key: input.key } };
}

export function decodeAttributeValueRows(
  rows: AttributeValueRowRaw[],
): string[] {
  return rows.map((row) => row.v);
}
