import { buildAttributeClauses } from "../../attribute-filter/sql/where";
import type {
  GetErrorIssuesQueryInput,
  SearchErrorIssuesInput,
} from "../data/schemas";
import { ERROR_STATUS_EVENT_TYPES } from "../data/types";
import { errorsAttributeColumn } from "./attribute-columns";
import { ERROR_FINGERPRINT_SQL, EXCEPTION_LOG_FILTER_SQL } from "./fingerprint";
import { ERROR_TRIAGE_EVENTS_TABLE, validateTableName } from "./table";

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
  input: Pick<
    SearchErrorIssuesInput,
    "fromTs" | "toTs" | "q" | "service" | "attributes"
  >,
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

// Aggregated per-fingerprint summary columns, shared by the plain and the
// triage-joined summary shapes.
const SUMMARY_COLUMNS_SQL = `
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
        argMax(toString(Timestamp), Timestamp) AS latestTimestamp`;

const STATUS_EVENT_TYPES_SQL = ERROR_STATUS_EVENT_TYPES.map(
  (type) => `'${type}'`,
).join(", ");

export type SummaryQueryOptions = {
  /**
   * Join the triage events table and derive each Error's Status (spec 0001):
   * the latest status event wins, ignored is sticky, and a resolved Error
   * reopens only on a genuine Regression (version-aware rule). Off by
   * default: surfaces without the table (local/desktop) emit the pre-triage
   * SQL.
   */
  triageEvents?: boolean;
};

export function buildSummaryQuery(
  input: SearchErrorIssuesInput,
  tableName: string,
  options: SummaryQueryOptions = {},
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

  const statusFilter =
    input.status.length > 0
      ? "WHERE status IN {statusFilter:Array(String)}"
      : "";
  if (input.status.length > 0) params.statusFilter = input.status;

  // Status derivation (spec 0001). Entries first resolve to their latest
  // version (edits and deletes are version appends, ADR 0004), then the
  // latest surviving status event per fingerprint wins. Aliases deliberately
  // avoid source column names: ClickHouse resolves identifiers inside
  // aggregates to same-name SELECT aliases. Tenant scoping comes from the
  // row-level policy on both tables; the fingerprint predicate additionally
  // lets the (tenant, fingerprint, event_id) primary key prune the triage
  // scan on detail-page loads.
  //
  // Regression rule (spec 0001): a resolved Error reopens iff an Occurrence
  // in the queried range comes from a service.version first seen (per
  // service, unbounded by the range so old releases stay old) after the
  // Resolution; version order is first-seen time only, never semver or SHA.
  // A versionless Occurrence falls back to its own timestamp. Same-version
  // stragglers from old deploys match neither branch and keep the Error
  // resolved. regressed is computed once and status reads it, so "any rule
  // reopen is a Regression" holds by construction; a manual reopen event is
  // open but not regressed. The first-seen scan prunes by the ORDER BY
  // prefix (services of versioned Occurrences of resolved Errors), so it
  // reads nothing when no resolved Error could regress.
  return {
    params,
    sql: `
      WITH ${cte.sql},
      issue_summaries AS (
        SELECT${SUMMARY_COLUMNS_SQL}
        FROM exception_logs
        ${fingerprintFilter}
        GROUP BY fingerprint
      ),
      latest_status_entries AS (
        SELECT
          any(fingerprint) AS entryFingerprint,
          argMax(event_type, version) AS entryType,
          argMax(deleted, version) AS entryDeleted,
          min(event_time) AS entryTime
        FROM ${ERROR_TRIAGE_EVENTS_TABLE}
        WHERE event_type IN (${STATUS_EVENT_TYPES_SQL})
          ${input.fingerprint ? "AND fingerprint = {fingerprint:String}" : ""}
        GROUP BY event_id
        HAVING entryDeleted = 0
      ),
      issue_status AS (
        SELECT
          entryFingerprint AS statusFingerprint,
          argMax(entryType, entryTime) AS lastStatusType,
          max(entryTime) AS lastStatusAt
        FROM latest_status_entries
        GROUP BY entryFingerprint
      ),
      resolved_issues AS (
        SELECT
          statusFingerprint AS resolvedFingerprint,
          lastStatusAt AS resolvedAt
        FROM issue_status
        WHERE lastStatusType = 'resolved'
      ),
      resolved_occurrence_versions AS (
        SELECT
          fingerprint AS occFingerprint,
          ServiceName AS occService,
          ResourceAttributes['service.version'] AS occVersion,
          max(Timestamp) AS occLastSeenAt,
          any(resolvedAt) AS occResolvedAt
        FROM exception_logs
        INNER JOIN resolved_issues ON fingerprint = resolvedFingerprint
        ${input.fingerprint ? "WHERE fingerprint = {fingerprint:String}" : ""}
        GROUP BY occFingerprint, occService, occVersion
      ),
      version_first_seen AS (
        SELECT
          ServiceName AS versionService,
          ResourceAttributes['service.version'] AS versionValue,
          min(Timestamp) AS versionFirstSeenAt
        FROM ${tableName}
        WHERE ServiceName IN (
            SELECT occService
            FROM resolved_occurrence_versions
            WHERE occVersion != ''
          )
          AND ResourceAttributes['service.version'] != ''
        GROUP BY versionService, versionValue
      ),
      issue_regressions AS (
        SELECT
          occFingerprint AS regressionFingerprint,
          -- A group's clock is its version's first-seen time; a versionless
          -- group falls back to its newest Occurrence.
          max(if(occVersion = '', occLastSeenAt, versionFirstSeenAt) > occResolvedAt) AS regressed
        FROM resolved_occurrence_versions
        LEFT ANY JOIN version_first_seen
          ON occService = versionService AND occVersion = versionValue
        GROUP BY regressionFingerprint
      )
      SELECT
        issue_summaries.*,
        regressed,
        multiIf(
          lastStatusType = 'ignored', 'ignored',
          regressed = 1, 'open',
          lastStatusType = 'resolved', 'resolved',
          'open'
        ) AS status
      FROM issue_summaries
      LEFT ANY JOIN issue_status ON fingerprint = statusFingerprint
      LEFT ANY JOIN issue_regressions ON fingerprint = regressionFingerprint
      ${statusFilter}
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
  const cte = buildExceptionLogsCte(
    { ...input, q: "", attributes: [] },
    tableName,
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
