import { buildAttributeClauses } from "../../attribute-filter/sql/where";
import type {
  GetErrorIssuesQueryInput,
  SearchErrorIssuesInput,
} from "../data/schemas";
import type { ErrorTriageStatus } from "../data/types";
import { errorsAttributeColumn } from "./attribute-columns";
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

// Occurrence rows need the full attribute maps; the summary aggregation only
// reads a handful of keys, so its projection extracts them once as narrow
// columns instead of dragging three Maps through the aggregation. The
// extracted names deliberately differ from the summary aliases (ClickHouse
// resolves identifiers inside aggregates to same-name SELECT aliases).
const PROJECTIONS = {
  occurrence: `
          Timestamp,
          ServiceName,
          TraceId,
          SpanId,
          Body,
          ResourceAttributes,
          ScopeAttributes,
          LogAttributes`,
  summary: `
          Timestamp,
          ServiceName,
          TraceId,
          SpanId,
          Body,
          LogAttributes['exception.type'] AS logExceptionType,
          LogAttributes['exception.message'] AS logExceptionMessage,
          ResourceAttributes['service.version'] AS serviceVersion`,
} as const;

function buildExceptionLogsCte(
  input: Pick<
    SearchErrorIssuesInput,
    "fromTs" | "toTs" | "q" | "service" | "attributes"
  >,
  tableName: string,
  projection: keyof typeof PROJECTIONS,
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

  const attr = buildAttributeClauses(
    input.attributes ?? [],
    errorsAttributeColumn,
  );
  filters.push(...attr.clauses);
  Object.assign(params, attr.params);

  return {
    params,
    sql: `
      exception_logs AS (
        SELECT${PROJECTIONS[projection]},
          ${ERROR_FINGERPRINT_SQL} AS fingerprint
        FROM ${tableName}
        WHERE ${filters.join("\n          AND ")}
      )
    `,
  };
}

// Aggregated per-fingerprint summary columns, shared by the plain and the
// triage-enabled summary shapes.
const SUMMARY_COLUMNS_SQL = `
        fingerprint,
        argMax(logExceptionType, Timestamp) AS exceptionType,
        argMax(logExceptionMessage, Timestamp) AS exceptionMessage,
        argMax(Body, Timestamp) AS body,
        argMax(ServiceName, Timestamp) AS latestServiceName,
        groupUniqArray(ServiceName) AS services,
        count() AS occurrenceCount,
        uniqExactIf(TraceId, TraceId != '') AS traceCount,
        toString(min(Timestamp)) AS firstSeen,
        toString(max(Timestamp)) AS lastSeen,
        argMax(TraceId, Timestamp) AS latestTraceId,
        argMax(SpanId, Timestamp) AS latestSpanId,
        argMax(toString(Timestamp), Timestamp) AS latestTimestamp`;

export type SummaryQueryOptions = {
  /**
   * Derive each Error's Status (spec 0001): the latest status event wins,
   * ignored is sticky, and a resolved Error reopens only on a genuine
   * Regression. The triage state arrives as triageStatuses (read separately
   * from the events table by buildTriageStatusesQuery) and travels into the
   * query as Map parameters, so the derivation costs no extra scan and no
   * join. Off by default: surfaces without the events table (local/desktop)
   * emit the pre-triage SQL.
   */
  triageEvents?: boolean;
  triageStatuses?: ErrorTriageStatus[];
};

// Triage state travels into the summary query as three Map parameters keyed
// by fingerprint; missing keys yield ClickHouse defaults ('', zero date, [])
// which all read as "no triage state".
function buildTriageStatusParams(
  statuses: ErrorTriageStatus[],
): Record<string, unknown> {
  const statusByFp: Record<string, string> = {};
  const resolvedAtByFp: Record<string, string> = {};
  const resolvedVersionsByFp: Record<string, string[]> = {};
  for (const status of statuses) {
    statusByFp[status.fingerprint] = status.type;
    if (status.type === "resolved") {
      resolvedAtByFp[status.fingerprint] = status.at;
      resolvedVersionsByFp[status.fingerprint] = status.resolvedVersions;
    }
  }
  return { statusByFp, resolvedAtByFp, resolvedVersionsByFp };
}

export function buildSummaryQuery(
  input: SearchErrorIssuesInput,
  tableName: string,
  options: SummaryQueryOptions = {},
): BuiltQuery {
  validateTableName(tableName);
  const cte = buildExceptionLogsCte(input, tableName, "summary");
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

  if (!options.triageEvents) {
    return {
      params,
      sql: `
      WITH ${cte.sql}
      SELECT${SUMMARY_COLUMNS_SQL}
      FROM exception_logs
      ${fingerprintFilter}
      GROUP BY fingerprint
      ORDER BY ${orderBy}
      LIMIT {limit:UInt32}
      OFFSET {offset:UInt32}
    `,
    };
  }

  Object.assign(params, buildTriageStatusParams(options.triageStatuses ?? []));
  const statusFilter =
    input.status.length > 0
      ? "HAVING status IN {statusFilter:Array(String)}"
      : "";
  if (input.status.length > 0) params.statusFilter = input.status;

  // Status derivation (spec 0001): the latest surviving status event per
  // fingerprint wins, delivered as Map params. Regression rule: a resolved
  // Error reopens iff an Occurrence in the queried range comes from a
  // service version outside the Resolution's resolve-time snapshot; version
  // membership, never semver or SHA order. A versionless Occurrence — or a
  // Resolution with no version knowledge (empty snapshot) — degrades to a
  // plain timestamp comparison against the Resolution. Snapshot-version
  // stragglers from old deploys keep the Error resolved. regressed is
  // computed once and status reads it, so "any rule reopen is a Regression"
  // holds by construction; a manual reopen event is open but not regressed.
  // With no triage state the maps are empty, every lookup hits its default,
  // and every Error derives as open.
  return {
    params,
    sql: `
      WITH ${cte.sql}
      SELECT${SUMMARY_COLUMNS_SQL},
        max(
          {statusByFp:Map(String, String)}[fingerprint] = 'resolved'
          AND if(
            serviceVersion = ''
              OR empty({resolvedVersionsByFp:Map(String, Array(String))}[fingerprint]),
            Timestamp > {resolvedAtByFp:Map(String, DateTime64(3))}[fingerprint],
            NOT has({resolvedVersionsByFp:Map(String, Array(String))}[fingerprint], serviceVersion)
          )
        ) AS regressed,
        multiIf(
          {statusByFp:Map(String, String)}[fingerprint] = 'ignored', 'ignored',
          regressed = 1, 'open',
          {statusByFp:Map(String, String)}[fingerprint] = 'resolved', 'resolved',
          'open'
        ) AS status
      FROM exception_logs
      ${fingerprintFilter}
      GROUP BY fingerprint
      ${statusFilter}
      ORDER BY ${orderBy}
      LIMIT {limit:UInt32}
      OFFSET {offset:UInt32}
    `,
  };
}

// Versions currently known for the services an Error occurred in, snapshotted
// onto a Resolution event at write time (spec 0001). Deliberately unbounded
// by any page range: Resolutions are rare, so the history scan is paid once
// per Resolution instead of on every list read. Tenant scoping comes from the
// row-level policy.
export function buildKnownServiceVersionsQuery(
  input: { fingerprint: string },
  tableName: string,
): BuiltQuery {
  validateTableName(tableName);
  return {
    params: { fingerprint: input.fingerprint },
    sql: `
      SELECT DISTINCT ResourceAttributes['service.version'] AS version
      FROM ${tableName}
      WHERE ServiceName IN (
          SELECT DISTINCT ServiceName
          FROM ${tableName}
          WHERE ${EXCEPTION_LOG_FILTER_SQL}
            AND ${ERROR_FINGERPRINT_SQL} = {fingerprint:String}
        )
        AND ResourceAttributes['service.version'] != ''
      ORDER BY version
      LIMIT 1000
    `,
  };
}

export function buildOccurrencesQuery(
  input: GetErrorIssuesQueryInput,
  tableName: string,
): BuiltQuery {
  validateTableName(tableName);
  const cte = buildExceptionLogsCte(
    { ...input, q: "", attributes: [] },
    tableName,
    "occurrence",
  );
  return {
    params: {
      ...cte.params,
      fingerprint: input.fingerprint,
      occurrenceLimit: input.occurrenceLimit,
    },
    sql: `
      WITH ${cte.sql},
      ranked_occurrence_rows AS (
        SELECT
          *,
          row_number() OVER (
            PARTITION BY Timestamp
            ORDER BY Timestamp DESC, ServiceName DESC, TraceId DESC, SpanId DESC, Body DESC
          ) AS timestampRank
        FROM exception_logs
        WHERE fingerprint = {fingerprint:String}
      )
      SELECT
        toUInt32(timestampRank) AS timestampRank,
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
      FROM ranked_occurrence_rows
      ORDER BY Timestamp DESC, timestampRank ASC
      LIMIT {occurrenceLimit:UInt32}
    `,
  };
}

export function buildServicesQuery(
  input: Pick<SearchErrorIssuesInput, "fromTs" | "toTs" | "attributes">,
  tableName: string,
): BuiltQuery {
  validateTableName(tableName);
  const params: Record<string, unknown> = {
    fromTs: input.fromTs,
    toTs: input.toTs,
  };
  const filters = [timePredicateSql(), EXCEPTION_LOG_FILTER_SQL];
  const attr = buildAttributeClauses(
    input.attributes ?? [],
    errorsAttributeColumn,
  );
  filters.push(...attr.clauses);
  Object.assign(params, attr.params);
  return {
    params,
    sql: `
    SELECT DISTINCT ServiceName AS serviceName
    FROM ${tableName}
    WHERE ${filters.join("\n      AND ")}
    ORDER BY serviceName
  `,
  };
}
