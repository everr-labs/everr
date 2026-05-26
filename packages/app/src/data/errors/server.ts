import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { ERROR_FINGERPRINT_SQL, EXCEPTION_LOG_FILTER_SQL } from "./fingerprint";
import {
  type GetErrorIssueInput,
  GetErrorIssueInputSchema,
  ListErrorServicesInputSchema,
  type SearchErrorIssuesInput,
  SearchErrorIssuesInputSchema,
} from "./schemas";
import type {
  ErrorIssueDetail,
  ErrorIssueSummary,
  ErrorOccurrence,
} from "./types";

type ClickhouseContext = {
  query: <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;
};

type ErrorIssueSummaryRow = Omit<
  ErrorIssueSummary,
  "occurrenceCount" | "traceCount"
> & {
  occurrenceCount: string | number;
  traceCount: string | number;
};

type ErrorOccurrenceRow = ErrorOccurrence & {
  resourceAttributes: Record<string, string> | null;
  logAttributes: Record<string, string> | null;
  scopeAttributes: Record<string, string> | null;
};

type ServiceRow = { serviceName: string };

function mapSummary(row: ErrorIssueSummaryRow): ErrorIssueSummary {
  return {
    ...row,
    occurrenceCount: Number(row.occurrenceCount),
    traceCount: Number(row.traceCount),
  };
}

function mapOccurrence(row: ErrorOccurrenceRow): ErrorOccurrence {
  return {
    ...row,
    resourceAttributes: row.resourceAttributes ?? {},
    logAttributes: row.logAttributes ?? {},
    scopeAttributes: row.scopeAttributes ?? {},
  };
}

function timePredicateSql(): string {
  return `
    TimestampTime >= toDateTime(parseDateTime64BestEffort({fromTs:String}, 9))
    AND TimestampTime <= toDateTime(parseDateTime64BestEffort({toTs:String}, 9))
    AND Timestamp >= parseDateTime64BestEffort({fromTs:String}, 9)
    AND Timestamp <= parseDateTime64BestEffort({toTs:String}, 9)
  `;
}

function buildBaseParams(
  input: Pick<SearchErrorIssuesInput, "fromTs" | "toTs" | "service">,
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    fromTs: input.fromTs,
    toTs: input.toTs,
  };
  if (input.service.length > 0) params.service = input.service;
  return params;
}

function buildExceptionLogsCte(
  input: Pick<SearchErrorIssuesInput, "fromTs" | "toTs" | "q" | "service">,
): { sql: string; params: Record<string, unknown> } {
  const params = buildBaseParams(input);
  const filters = [timePredicateSql(), EXCEPTION_LOG_FILTER_SQL];

  if (input.service.length > 0) {
    filters.push("ServiceName IN {service:Array(String)}");
  }
  if (input.q) {
    filters.push(`(
      positionCaseInsensitive(LogAttributes['exception.type'], {q:String}) > 0
      OR positionCaseInsensitive(LogAttributes['exception.message'], {q:String}) > 0
      OR positionCaseInsensitive(Body, {q:String}) > 0
    )`);
    params.q = input.q;
  }

  return {
    params,
    sql: `
      exception_logs AS (
        SELECT
          Timestamp,
          ServiceName,
          TraceId,
          SpanId,
          Body,
          ResourceAttributes,
          ScopeAttributes,
          LogAttributes,
          ${ERROR_FINGERPRINT_SQL} AS fingerprint
        FROM app.logs
        WHERE ${filters.join("\n          AND ")}
      )
    `,
  };
}

function buildSummaryQuery(input: SearchErrorIssuesInput): {
  sql: string;
  params: Record<string, unknown>;
} {
  const cte = buildExceptionLogsCte(input);
  const params = { ...cte.params, limit: input.limit };
  const fingerprintFilter = input.fingerprint
    ? "WHERE fingerprint = {fingerprint:String}"
    : "";
  if (input.fingerprint) params.fingerprint = input.fingerprint;
  const orderBy =
    input.sort === "count"
      ? "occurrenceCount DESC, lastSeen DESC"
      : "lastSeen DESC, occurrenceCount DESC";

  return {
    params,
    sql: `
      WITH ${cte.sql}
      SELECT
        fingerprint,
        argMax(LogAttributes['exception.type'], Timestamp) AS exceptionType,
        argMax(LogAttributes['exception.message'], Timestamp) AS exceptionMessage,
        argMax(Body, Timestamp) AS body,
        argMax(ServiceName, Timestamp) AS latestServiceName,
        groupUniqArray(ServiceName) AS services,
        count() AS occurrenceCount,
        uniqExactIf(TraceId, TraceId != '') AS traceCount,
        toString(min(Timestamp)) AS firstSeen,
        toString(max(Timestamp)) AS lastSeen,
        argMax(TraceId, Timestamp) AS latestTraceId,
        argMax(SpanId, Timestamp) AS latestSpanId,
        argMax(toString(Timestamp), Timestamp) AS latestTimestamp
      FROM exception_logs
      ${fingerprintFilter}
      GROUP BY fingerprint
      ORDER BY ${orderBy}
      LIMIT {limit:UInt32}
    `,
  };
}

function buildOccurrencesQuery(input: GetErrorIssueInput): {
  sql: string;
  params: Record<string, unknown>;
} {
  const cte = buildExceptionLogsCte({ ...input, q: "" });
  return {
    params: {
      ...cte.params,
      fingerprint: input.fingerprint,
      occurrenceLimit: input.occurrenceLimit,
    },
    sql: `
      WITH ${cte.sql}
      SELECT
        fingerprint,
        toString(Timestamp) AS timestamp,
        ServiceName AS serviceName,
        TraceId AS traceId,
        SpanId AS spanId,
        Body AS body,
        LogAttributes['exception.type'] AS exceptionType,
        LogAttributes['exception.message'] AS exceptionMessage,
        LogAttributes['exception.stacktrace'] AS exceptionStacktrace,
        ResourceAttributes AS resourceAttributes,
        LogAttributes AS logAttributes,
        ScopeAttributes AS scopeAttributes
      FROM exception_logs
      WHERE fingerprint = {fingerprint:String}
      ORDER BY Timestamp DESC
      LIMIT {occurrenceLimit:UInt32}
    `,
  };
}

export const searchErrorIssues = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(SearchErrorIssuesInputSchema)
  .handler(async ({ data, context: { clickhouse } }) => {
    const { sql, params } = buildSummaryQuery(data);
    const rows = await (
      clickhouse as ClickhouseContext
    ).query<ErrorIssueSummaryRow>(sql, params);
    return rows.map(mapSummary);
  });

export const getErrorIssue = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(GetErrorIssueInputSchema)
  .handler(async ({ data, context: { clickhouse } }) => {
    const summaryInput: SearchErrorIssuesInput = {
      fromTs: data.fromTs,
      toTs: data.toTs,
      q: "",
      service: data.service,
      fingerprint: data.fingerprint,
      sort: "lastSeen",
      limit: 1,
    };
    const summaryQuery = buildSummaryQuery(summaryInput);
    const summaryRows = await (
      clickhouse as ClickhouseContext
    ).query<ErrorIssueSummaryRow>(summaryQuery.sql, summaryQuery.params);
    const summary = summaryRows[0] ? mapSummary(summaryRows[0]) : undefined;
    if (!summary) throw new Error("Error issue not found");

    const occurrencesQuery = buildOccurrencesQuery(data);
    const occurrenceRows = await (
      clickhouse as ClickhouseContext
    ).query<ErrorOccurrenceRow>(occurrencesQuery.sql, occurrencesQuery.params);
    const occurrences = occurrenceRows.map(mapOccurrence);
    const latest = occurrences[0];
    if (!latest) throw new Error("Error issue not found");

    return { summary, latest, occurrences } satisfies ErrorIssueDetail;
  });

export const listErrorServices = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(ListErrorServicesInputSchema)
  .handler(async ({ data, context: { clickhouse } }) => {
    const rows = await (clickhouse as ClickhouseContext).query<ServiceRow>(
      `
        SELECT DISTINCT ServiceName AS serviceName
        FROM app.logs
        WHERE ${timePredicateSql()}
          AND ${EXCEPTION_LOG_FILTER_SQL}
        ORDER BY serviceName
      `,
      { fromTs: data.fromTs, toTs: data.toTs },
    );
    return rows.map((row) => row.serviceName).filter(Boolean);
  });
