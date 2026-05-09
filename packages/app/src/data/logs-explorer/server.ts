import { z } from "zod";
import { normalizeTimestampToUtc } from "@/lib/formatting";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { resolveTimeRange, TimeRangeSchema } from "@/lib/time-range";
import {
  type LogDetail,
  type LogExplorerRow,
  type LogFilterOptions,
  type LogHistogramBucket,
  LogHistogramInputSchema,
  LogIdentitySchema,
  type LogLevel,
  LogsExplorerInputSchema,
  type LogsExplorerResult,
  LogsTotalsInputSchema,
  type LogsTotalsResult,
} from "./schemas";

const LOG_LEVEL_EXPR = `
  multiIf(
    SeverityNumber >= 17, 'error',
    SeverityNumber >= 13, 'warning',
    SeverityNumber >= 9, 'info',
    SeverityNumber >= 5, 'debug',
    SeverityNumber >= 1, 'trace',
    lowerUTF8(SeverityText) IN ('fatal', 'error', 'critical'), 'error',
    lowerUTF8(SeverityText) IN ('warn', 'warning'), 'warning',
    lowerUTF8(SeverityText) = 'info', 'info',
    lowerUTF8(SeverityText) = 'debug', 'debug',
    lowerUTF8(SeverityText) = 'trace', 'trace',
    'unknown'
  )
`;

const LOG_LEVELS = [
  "error",
  "warning",
  "info",
  "debug",
  "trace",
  "unknown",
] as const satisfies readonly LogLevel[];

function buildWhereClause(input: {
  query?: string;
  levels: LogLevel[];
  services: string[];
  repos: string[];
  traceId?: string;
  includeLevels?: boolean;
}) {
  const clauses = [
    "TimestampTime >= parseDateTimeBestEffort({fromTime:String})",
    "TimestampTime <= parseDateTimeBestEffort({toTime:String})",
  ];

  if (input.query) {
    clauses.push("positionCaseInsensitive(Body, {query:String}) > 0");
  }

  if (input.includeLevels !== false && input.levels.length > 0) {
    clauses.push(`${LOG_LEVEL_EXPR} IN {levels:Array(String)}`);
  }

  if (input.services.length > 0) {
    clauses.push("ServiceName IN {services:Array(String)}");
  }

  if (input.repos.length > 0) {
    clauses.push(
      "ResourceAttributes['vcs.repository.name'] IN {repos:Array(String)}",
    );
  }

  if (input.traceId) {
    clauses.push("TraceId = {traceId:String}");
  }

  return clauses.join("\n      AND ");
}

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

function bucketSeconds(
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
    HISTOGRAM_INTERVAL_SECONDS.find((seconds) => seconds >= idealSeconds) ??
    HISTOGRAM_INTERVAL_SECONDS[HISTOGRAM_INTERVAL_SECONDS.length - 1]
  );
}

function mapLogRow(row: {
  timestampRaw: string;
  level: LogLevel;
  body: string;
  traceId: string;
  spanId: string;
  serviceName: string;
  bodyHash: string;
}): LogExplorerRow {
  const identity = {
    timestampRaw: row.timestampRaw,
    traceId: row.traceId,
    spanId: row.spanId,
    serviceName: row.serviceName,
    bodyHash: row.bodyHash,
  };
  return {
    id: [
      row.timestampRaw,
      row.traceId,
      row.spanId,
      row.serviceName,
      row.bodyHash,
    ].join("|"),
    identity,
    timestamp: normalizeTimestampToUtc(row.timestampRaw),
    level: row.level,
    body: row.body,
  };
}

function mapHistogramRow(row: {
  bucket: string;
  intervalSeconds: number;
  total: string | number;
  error: string | number;
  warning: string | number;
  info: string | number;
  debug: string | number;
  trace: string | number;
  unknown: string | number;
}): LogHistogramBucket {
  const timestamp = normalizeTimestampToUtc(row.bucket);
  const date = new Date(timestamp);
  const endDate = new Date(date.getTime() + row.intervalSeconds * 1000);
  const timeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
  } satisfies Intl.DateTimeFormatOptions;
  return {
    timestamp,
    endTimestamp: endDate.toISOString(),
    timeLabel: date.toLocaleTimeString([], timeFormatOptions),
    rangeLabel: `${date.toLocaleTimeString([], timeFormatOptions)} - ${endDate.toLocaleTimeString([], timeFormatOptions)}`,
    total: Number(row.total),
    error: Number(row.error),
    warning: Number(row.warning),
    info: Number(row.info),
    debug: Number(row.debug),
    trace: Number(row.trace),
    unknown: Number(row.unknown),
  };
}

function fillHistogramBuckets(
  rows: Array<{
    bucket: string;
    total: string | number;
    error: string | number;
    warning: string | number;
    info: string | number;
    debug: string | number;
    trace: string | number;
    unknown: string | number;
  }>,
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

function emptyLevelCounts(): Record<LogLevel, number> {
  return {
    error: 0,
    warning: 0,
    info: 0,
    debug: 0,
    trace: 0,
    unknown: 0,
  };
}

export const getLogsExplorer = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(LogsExplorerInputSchema)
  .handler(async ({ data, context: { clickhouse } }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);
    const whereClause = buildWhereClause(data);

    const rows = await clickhouse.query<{
      timestampRaw: string;
      level: LogLevel;
      body: string;
      traceId: string;
      spanId: string;
      serviceName: string;
      bodyHash: string;
    }>(
      `
      SELECT
        Timestamp AS timestampRaw,
        ${LOG_LEVEL_EXPR} AS level,
        Body AS body,
        TraceId AS traceId,
        SpanId AS spanId,
        ServiceName AS serviceName,
        toString(cityHash64(Body)) AS bodyHash
      FROM logs
      WHERE ${whereClause}
      ORDER BY Timestamp DESC
      LIMIT {limit:UInt32}
      OFFSET {offset:UInt32}
      `,
      {
        fromTime: fromISO,
        toTime: toISO,
        query: data.query,
        levels: data.levels,
        services: data.services,
        repos: data.repos,
        traceId: data.traceId,
        limit: data.limit,
        offset: data.offset,
      },
    );

    return { logs: rows.map(mapLogRow) } satisfies LogsExplorerResult;
  });

export const getLogsTotals = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(LogsTotalsInputSchema)
  .handler(async ({ data, context: { clickhouse } }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);
    const facetWhereClause = buildWhereClause({
      ...data,
      includeLevels: false,
    });

    const queryParams = {
      fromTime: fromISO,
      toTime: toISO,
      query: data.query,
      levels: data.levels,
      services: data.services,
      repos: data.repos,
      traceId: data.traceId,
    };

    const rows = await clickhouse.query<Record<LogLevel, string>>(
      `
      SELECT
        countIf(level = 'error') AS error,
        countIf(level = 'warning') AS warning,
        countIf(level = 'info') AS info,
        countIf(level = 'debug') AS debug,
        countIf(level = 'trace') AS trace,
        countIf(level = 'unknown') AS unknown
      FROM (
        SELECT ${LOG_LEVEL_EXPR} AS level
        FROM logs
        WHERE ${facetWhereClause}
      )
      `,
      queryParams,
    );

    const row = rows[0];
    const levelCounts = emptyLevelCounts();
    if (row) {
      for (const level of LOG_LEVELS) {
        levelCounts[level] = Number(row[level] ?? 0);
      }
    }

    const selectedLevels: readonly LogLevel[] =
      data.levels.length > 0 ? data.levels : LOG_LEVELS;
    const totalCount = selectedLevels.reduce(
      (sum, level) => sum + levelCounts[level],
      0,
    );

    return { totalCount, levelCounts } satisfies LogsTotalsResult;
  });

export const getLogDetail = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(LogIdentitySchema)
  .handler(async ({ data, context: { clickhouse } }): Promise<LogDetail> => {
    const rows = await clickhouse.query<{
      timestampRaw: string;
      level: LogLevel;
      severityText: string;
      severityNumber: string;
      serviceName: string;
      traceId: string;
      spanId: string;
      resourceAttributes: Record<string, string>;
      logAttributes: Record<string, string>;
      scopeAttributes: Record<string, string>;
    }>(
      `
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
      FROM logs
      WHERE TimestampTime = toDateTime(parseDateTime64BestEffort({timestampRaw:String}, 9))
        AND Timestamp = parseDateTime64BestEffort({timestampRaw:String}, 9)
        AND ServiceName = {serviceName:String}
        AND TraceId = {traceId:String}
        AND SpanId = {spanId:String}
        AND toString(cityHash64(Body)) = {bodyHash:String}
      LIMIT 1
      `,
      data,
    );

    const row = rows[0];
    if (!row) {
      throw new Error("Log entry not found");
    }
    return {
      timestamp: normalizeTimestampToUtc(row.timestampRaw),
      level: row.level,
      severityText: row.severityText,
      severityNumber: Number(row.severityNumber),
      serviceName: row.serviceName,
      traceId: row.traceId,
      spanId: row.spanId,
      resourceAttributes: row.resourceAttributes ?? {},
      logAttributes: row.logAttributes ?? {},
      scopeAttributes: row.scopeAttributes ?? {},
    };
  });

export const getLogsHistogram = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(LogHistogramInputSchema)
  .handler(async ({ data, context: { clickhouse } }) => {
    const { fromISO, toISO, fromDate, toDate } = resolveTimeRange(
      data.timeRange,
    );
    const whereClause = buildWhereClause(data);
    const intervalSeconds = bucketSeconds(
      fromDate,
      toDate,
      data.histogramBuckets,
    );
    const queryParams = {
      fromTime: fromISO,
      toTime: toISO,
      query: data.query,
      levels: data.levels,
      services: data.services,
      repos: data.repos,
      traceId: data.traceId,
    };

    const histogram = await clickhouse.query<{
      bucket: string;
      total: string;
      error: string;
      warning: string;
      info: string;
      debug: string;
      trace: string;
      unknown: string;
    }>(
      `
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
        FROM logs
        WHERE ${whereClause}
      )
      GROUP BY bucket
      ORDER BY bucket ASC
      `,
      queryParams,
    );

    return fillHistogramBuckets(histogram, fromDate, toDate, intervalSeconds);
  });

export const getLogFilterOptions = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(z.object({ timeRange: TimeRangeSchema }))
  .handler(async ({ data, context: { clickhouse } }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);
    const result = await clickhouse.query<{
      services: string[];
      repos: string[];
    }>(
      `
      SELECT
        (SELECT groupArray(v) FROM (
          SELECT DISTINCT ServiceName AS v
          FROM logs
          WHERE TimestampTime >= parseDateTimeBestEffort({fromTime:String})
            AND TimestampTime <= parseDateTimeBestEffort({toTime:String})
            AND ServiceName != ''
          ORDER BY v
          LIMIT 100
        )) AS services,
        (SELECT groupArray(v) FROM (
          SELECT DISTINCT ResourceAttributes['vcs.repository.name'] AS v
          FROM logs
          WHERE TimestampTime >= parseDateTimeBestEffort({fromTime:String})
            AND TimestampTime <= parseDateTimeBestEffort({toTime:String})
            AND ResourceAttributes['vcs.repository.name'] != ''
          ORDER BY v
          LIMIT 100
        )) AS repos
      `,
      { fromTime: fromISO, toTime: toISO },
    );

    const row = result[0];
    return {
      services: row?.services ?? [],
      repos: row?.repos ?? [],
    } satisfies LogFilterOptions;
  });
