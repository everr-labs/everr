import { z } from "zod";
import { normalizeTimestampToUtc } from "@/lib/formatting";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { resolveTimeRange, TimeRangeSchema } from "@/lib/time-range";
import {
  type LogExplorerRow,
  type LogFilterOptions,
  type LogHistogramBucket,
  type LogLevel,
  LogsExplorerInputSchema,
  type LogsExplorerResult,
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

function bucketSeconds(fromDate: Date, toDate: Date): number {
  const durationSeconds = Math.max(
    1,
    (toDate.getTime() - fromDate.getTime()) / 1000,
  );
  if (durationSeconds <= 30 * 60) return 60;
  if (durationSeconds <= 3 * 60 * 60) return 5 * 60;
  if (durationSeconds <= 12 * 60 * 60) return 15 * 60;
  if (durationSeconds <= 3 * 24 * 60 * 60) return 60 * 60;
  return 6 * 60 * 60;
}

function mapLogRow(row: {
  timestamp: string;
  serviceName: string;
  level: LogLevel;
  severityText: string;
  severityNumber: string | number;
  body: string;
  traceId: string;
  spanId: string;
  repo: string;
  branch: string;
  workflowName: string;
  runId: string;
  jobId: string;
  jobName: string;
  stepNumber: string;
}): LogExplorerRow {
  const timestamp = normalizeTimestampToUtc(row.timestamp);
  return {
    id: [
      timestamp,
      row.traceId,
      row.spanId,
      row.jobId,
      row.stepNumber,
      row.body.slice(0, 80),
    ].join(":"),
    timestamp,
    serviceName: row.serviceName,
    level: row.level,
    severityText: row.severityText,
    severityNumber: Number(row.severityNumber),
    body: row.body,
    traceId: row.traceId,
    spanId: row.spanId,
    repo: row.repo,
    branch: row.branch,
    workflowName: row.workflowName,
    runId: row.runId,
    jobId: row.jobId,
    jobName: row.jobName,
    stepNumber: row.stepNumber,
  };
}

function mapHistogramRow(row: {
  bucket: string;
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
  return {
    timestamp,
    timeLabel: date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    total: Number(row.total),
    error: Number(row.error),
    warning: Number(row.warning),
    info: Number(row.info),
    debug: Number(row.debug),
    trace: Number(row.trace),
    unknown: Number(row.unknown),
  };
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
    const { fromISO, toISO, fromDate, toDate } = resolveTimeRange(
      data.timeRange,
    );
    const whereClause = buildWhereClause(data);
    const facetWhereClause = buildWhereClause({
      ...data,
      includeLevels: false,
    });
    const intervalSeconds = bucketSeconds(fromDate, toDate);
    const queryParams = {
      fromTime: fromISO,
      toTime: toISO,
      query: data.query,
      levels: data.levels,
      services: data.services,
      repos: data.repos,
      traceId: data.traceId,
      limit: data.limit,
      offset: data.offset,
    };

    const rowsPromise = clickhouse.query<{
      timestamp: string;
      serviceName: string;
      level: LogLevel;
      severityText: string;
      severityNumber: string;
      body: string;
      traceId: string;
      spanId: string;
      repo: string;
      branch: string;
      workflowName: string;
      runId: string;
      jobId: string;
      jobName: string;
      stepNumber: string;
    }>(
      `
      SELECT
        Timestamp AS timestamp,
        ServiceName AS serviceName,
        ${LOG_LEVEL_EXPR} AS level,
        SeverityText AS severityText,
        SeverityNumber AS severityNumber,
        Body AS body,
        TraceId AS traceId,
        SpanId AS spanId,
        ResourceAttributes['vcs.repository.name'] AS repo,
        ResourceAttributes['vcs.ref.head.name'] AS branch,
        ResourceAttributes['cicd.pipeline.name'] AS workflowName,
        ResourceAttributes['cicd.pipeline.run.id'] AS runId,
        ResourceAttributes['cicd.pipeline.task.run.id'] AS jobId,
        ScopeAttributes['cicd.pipeline.task.name'] AS jobName,
        LogAttributes['everr.github.workflow_job_step.number'] AS stepNumber
      FROM logs
      WHERE ${whereClause}
      ORDER BY Timestamp DESC
      LIMIT {limit:UInt32}
      OFFSET {offset:UInt32}
      `,
      queryParams,
    );

    if (data.includeSummary === false) {
      const rows = await rowsPromise;
      return {
        logs: rows.map(mapLogRow),
        totalCount: 0,
        histogram: [],
        levelCounts: emptyLevelCounts(),
      } satisfies LogsExplorerResult;
    }

    const [rows, counts, levelCountsRows, histogram] = await Promise.all([
      rowsPromise,
      clickhouse.query<{ total: string }>(
        `
        SELECT
          count() AS total
        FROM logs
        WHERE ${whereClause}
        `,
        queryParams,
      ),
      clickhouse.query<Record<LogLevel, string>>(
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
      ),
      clickhouse.query<{
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
      ),
    ]);

    const countsRow = counts[0];
    const levelCountsRow = levelCountsRows[0];
    const levelCounts = emptyLevelCounts();
    if (levelCountsRow) {
      for (const level of LOG_LEVELS) {
        levelCounts[level] = Number(levelCountsRow[level] ?? 0);
      }
    }

    return {
      logs: rows.map(mapLogRow),
      totalCount: Number(countsRow?.total ?? 0),
      histogram: histogram.map(mapHistogramRow),
      levelCounts,
    } satisfies LogsExplorerResult;
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
