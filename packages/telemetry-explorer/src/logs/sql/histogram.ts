import { bucketSeconds, bucketStartMs } from "@everr/ui/lib/bucket";
import { resolveTimeRange } from "@everr/ui/lib/time-range";
import type { LogHistogramBucket, LogHistogramInput } from "../schemas";
import { normalizeTimestampToUtc } from "../util/timestamp";
import type { BuiltQuery } from "./explorer";
import { LOG_LEVEL_EXPR } from "./level-expr";
import { validateTableName } from "./table";
import { buildWhereClause } from "./where";

export interface HistogramRowRaw {
  bucket: string;
  total: string | number;
  error: string | number;
  warning: string | number;
  info: string | number;
  debug: string | number;
  trace: string | number;
  unknown: string | number;
}

export interface HistogramBuilt extends BuiltQuery {
  intervalSeconds: number;
  utcOffsetMinutes: number;
  fromDate: Date;
  toDate: Date;
}

export function buildHistogramQuery(
  input: LogHistogramInput,
  opts: { tableName?: string } = {},
): HistogramBuilt {
  const tableName = opts.tableName ?? "logs";
  validateTableName(tableName);
  const { fromISO, toISO, fromDate, toDate } = resolveTimeRange(input.timeRange);
  const where = buildWhereClause(input);
  const intervalSeconds = bucketSeconds(fromDate, toDate, input.histogramBuckets);
  const sql = `
      SELECT
        toStartOfInterval(
          toDateTime(Timestamp) + toIntervalSecond({utcOffsetSeconds:Int32}),
          INTERVAL ${intervalSeconds} SECOND
        ) - toIntervalSecond({utcOffsetSeconds:Int32}) AS bucket,
        count() AS total,
        countIf(level = 'error') AS error,
        countIf(level = 'warning') AS warning,
        countIf(level = 'info') AS info,
        countIf(level = 'debug') AS debug,
        countIf(level = 'trace') AS trace,
        countIf(level = 'unknown') AS unknown
      FROM (
        SELECT Timestamp, ${LOG_LEVEL_EXPR} AS level
        FROM ${tableName}
        WHERE ${where.clause}
      )
      GROUP BY bucket
      ORDER BY bucket ASC
      `;
  return {
    sql,
    params: {
      fromTime: fromISO,
      toTime: toISO,
      query: input.query,
      levels: input.levels,
      services: input.services,
      traceId: input.traceId,
      utcOffsetSeconds: input.utcOffsetMinutes * 60,
      ...where.params,
    },
    intervalSeconds,
    utcOffsetMinutes: input.utcOffsetMinutes,
    fromDate,
    toDate,
  };
}

function mapHistogramRow(row: HistogramRowRaw & { intervalSeconds: number }): LogHistogramBucket {
  const timestamp = normalizeTimestampToUtc(row.bucket);
  const date = new Date(timestamp);
  const endDate = new Date(date.getTime() + row.intervalSeconds * 1000);
  return {
    timestamp,
    endTimestamp: endDate.toISOString(),
    total: Number(row.total),
    error: Number(row.error),
    warning: Number(row.warning),
    info: Number(row.info),
    debug: Number(row.debug),
    trace: Number(row.trace),
    unknown: Number(row.unknown),
  };
}

export function fillHistogramBuckets(
  rows: HistogramRowRaw[],
  fromDate: Date,
  toDate: Date,
  intervalSeconds: number,
  utcOffsetMinutes = 0,
): LogHistogramBucket[] {
  const intervalMs = intervalSeconds * 1000;
  const startMs = bucketStartMs(fromDate.getTime(), intervalSeconds, utcOffsetMinutes);
  const endMs = bucketStartMs(toDate.getTime(), intervalSeconds, utcOffsetMinutes);
  const rowsByBucket = new Map(
    rows.map((row) => [new Date(normalizeTimestampToUtc(row.bucket)).getTime(), row]),
  );
  const buckets: LogHistogramBucket[] = [];
  for (let bucketMs = startMs; bucketMs <= endMs; bucketMs += intervalMs) {
    const row = rowsByBucket.get(bucketMs);
    buckets.push(
      row
        ? mapHistogramRow({ ...row, intervalSeconds })
        : mapHistogramRow({
            bucket: new Date(bucketMs).toISOString(),
            intervalSeconds,
            total: 0,
            error: 0,
            warning: 0,
            info: 0,
            debug: 0,
            trace: 0,
            unknown: 0,
          }),
    );
  }
  return buckets;
}
