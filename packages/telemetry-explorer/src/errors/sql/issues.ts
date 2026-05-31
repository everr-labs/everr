import type {
  GetErrorIssuesQueryInput,
  SearchErrorIssuesInput,
} from "../data/schemas";
import { ERROR_FINGERPRINT_SQL, EXCEPTION_LOG_FILTER_SQL } from "./fingerprint";
import { validateTableName } from "./table";

export type BuiltQuery = { sql: string; params: Record<string, unknown> };

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
  tableName: string,
): BuiltQuery {
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
        FROM ${tableName}
        WHERE ${filters.join("\n          AND ")}
      )
    `,
  };
}

export function buildSummaryQuery(
  input: SearchErrorIssuesInput,
  tableName: string,
): BuiltQuery {
  validateTableName(tableName);
  const cte = buildExceptionLogsCte(input, tableName);
  const params: Record<string, unknown> = {
    ...cte.params,
    limit: input.limit,
    offset: input.offset,
  };
  const fingerprintFilter = input.fingerprint
    ? "WHERE fingerprint = {fingerprint:String}"
    : "";
  if (input.fingerprint) params.fingerprint = input.fingerprint;
  // fingerprint is the unique GROUP BY key — append it as a deterministic
  // tiebreaker so offset paging stays stable across infinite-scroll fetches.
  const orderBy =
    input.sort === "count"
      ? "occurrenceCount DESC, lastSeen DESC, fingerprint DESC"
      : "lastSeen DESC, occurrenceCount DESC, fingerprint DESC";

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
      OFFSET {offset:UInt32}
    `,
  };
}

export function buildOccurrencesQuery(
  input: GetErrorIssuesQueryInput,
  tableName: string,
): BuiltQuery {
  validateTableName(tableName);
  const cte = buildExceptionLogsCte({ ...input, q: "" }, tableName);
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

export function buildServicesQuery(
  input: Pick<SearchErrorIssuesInput, "fromTs" | "toTs">,
  tableName: string,
): BuiltQuery {
  validateTableName(tableName);
  return {
    params: { fromTs: input.fromTs, toTs: input.toTs },
    sql: `
    SELECT DISTINCT ServiceName AS serviceName
    FROM ${tableName}
    WHERE ${timePredicateSql()}
      AND ${EXCEPTION_LOG_FILTER_SQL}
    ORDER BY serviceName
  `,
  };
}
