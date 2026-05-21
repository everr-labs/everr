import type { LogHistogramBucket, LogHistogramInput } from "../schemas";
import { resolveTimeRange } from "../time-range";
import { normalizeTimestampToUtc } from "../util/timestamp";
import type { BuiltQuery } from "./explorer";
import { LOG_LEVEL_EXPR } from "./level-expr";
import { validateTableName } from "./table";
import { buildWhereClause } from "./where";

const HISTOGRAM_INTERVAL_SECONDS = [
  1,
  5,
  10,
  15,
  30,
  60,
  2 * 60,
  5 * 60,
  10 * 60,
  15 * 60,
  30 * 60,
  60 * 60,
  2 * 60 * 60,
  6 * 60 * 60,
  12 * 60 * 60,
  24 * 60 * 60,
] as const;

export function bucketSeconds(
  fromDate: Date,
  toDate: Date,
  targetBuckets: number,
): number {
  const durationSeconds = Math.max(
    1,
    (toDate.getTime() - fromDate.getTime()) / 1000,
  );
  const idealSeconds = durationSeconds / targetBuckets;
  return (
    HISTOGRAM_INTERVAL_SECONDS.find((s) => s >= idealSeconds) ??
    HISTOGRAM_INTERVAL_SECONDS[HISTOGRAM_INTERVAL_SECONDS.length - 1]
  );
}

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
  fromDate: Date;
  toDate: Date;
}

export function buildHistogramQuery(
  input: LogHistogramInput,
  opts: { tableName?: string } = {},
): HistogramBuilt {
  const tableName = opts.tableName ?? "logs";
  validateTableName(tableName);
  const { fromISO, toISO, fromDate, toDate } = resolveTimeRange(
    input.timeRange,
  );
  const whereClause = buildWhereClause(input);
  const intervalSeconds = bucketSeconds(
    fromDate,
    toDate,
    input.histogramBuckets,
  );
  const sql = `
      SELECT
        toStartOfInterval(TimestampTime, INTERVAL ${intervalSeconds} SECOND) AS bucket,
        count() AS total,
        countIf(level = 'error') AS error,
        countIf(level = 'warning') AS warning,
        countIf(level = 'info') AS info,
        countIf(level = 'debug') AS debug,
        countIf(level = 'trace') AS trace,
        countIf(level = 'unknown') AS unknown
      FROM (
        SELECT TimestampTime, ${LOG_LEVEL_EXPR} AS level
        FROM ${tableName}
        WHERE ${whereClause}
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
      repos: input.repos,
      traceId: input.traceId,
    },
    intervalSeconds,
    fromDate,
    toDate,
  };
}

function mapHistogramRow(
  row: HistogramRowRaw & { intervalSeconds: number },
): LogHistogramBucket {
  const timestamp = normalizeTimestampToUtc(row.bucket);
  const date = new Date(timestamp);
  const endDate = new Date(date.getTime() + row.intervalSeconds * 1000);
  const opts = {
    hour: "2-digit",
    minute: "2-digit",
  } satisfies Intl.DateTimeFormatOptions;
  return {
    timestamp,
    endTimestamp: endDate.toISOString(),
    timeLabel: date.toLocaleTimeString([], opts),
    rangeLabel: `${date.toLocaleTimeString([], opts)} - ${endDate.toLocaleTimeString([], opts)}`,
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
): LogHistogramBucket[] {
  const intervalMs = intervalSeconds * 1000;
  const startMs = Math.floor(fromDate.getTime() / intervalMs) * intervalMs;
  const endMs = Math.floor(toDate.getTime() / intervalMs) * intervalMs;
  const rowsByBucket = new Map(
    rows.map((row) => [
      new Date(normalizeTimestampToUtc(row.bucket)).getTime(),
      row,
    ]),
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
