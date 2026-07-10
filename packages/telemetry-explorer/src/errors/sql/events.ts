import { ERROR_STATUS_EVENT_TYPES } from "../data/types";
import type { BuiltQuery } from "./issues";
import { ERROR_TRIAGE_EVENTS_TABLE } from "./table";

const STATUS_EVENT_TYPES_SQL = ERROR_STATUS_EVENT_TYPES.map(
  (type) => `'${type}'`,
).join(", ");

// Latest surviving status event per fingerprint: the whole triage state the
// summary derivation needs (spec 0001), read in one scan of the events table
// so the logs query can take it as plain parameters instead of joins. The
// table is small and human-written (ADR 0004), so the tenant-wide read is
// cheap; detail loads pass the fingerprint and prune by the primary key.
// Entries first resolve to their latest version (edits and deletes are
// version appends), then the latest event wins. resolvedVersions is the
// winning event's resolve-time snapshot; non-Resolution events carry [].
export function buildTriageStatusesQuery(input: {
  fingerprint?: string;
}): BuiltQuery {
  const params: Record<string, unknown> = {};
  if (input.fingerprint) params.fingerprint = input.fingerprint;
  return {
    params,
    sql: `
      SELECT
        entryFingerprint AS fingerprint,
        argMax(entryType, entryTime) AS lastStatusType,
        toString(max(entryTime)) AS lastStatusAt,
        argMax(entryVersions, entryTime) AS resolvedVersions
      FROM (
        SELECT
          fingerprint AS entryFingerprint,
          argMax(event_type, version) AS entryType,
          argMax(deleted, version) AS entryDeleted,
          argMax(resolved_versions, version) AS entryVersions,
          min(event_time) AS entryTime
        FROM ${ERROR_TRIAGE_EVENTS_TABLE}
        WHERE event_type IN (${STATUS_EVENT_TYPES_SQL})
          ${input.fingerprint ? "AND fingerprint = {fingerprint:String}" : ""}
        GROUP BY entryFingerprint, event_id
        HAVING entryDeleted = 0
      )
      GROUP BY entryFingerprint
    `,
  };
}

// Latest version per entry, deleted entries dropped. Versions are resolved
// explicitly (argMax) because ReplacingMergeTree collapses them only at merge
// time. Full history for the Fingerprint, deliberately unbounded by the
// page's time range. Tenant scoping comes from the row-level policy.
export function buildTriageEventsQuery(input: {
  fingerprint: string;
  limit: number;
}): BuiltQuery {
  return {
    params: {
      fingerprint: input.fingerprint,
      limit: input.limit,
    },
    // Aliases deliberately avoid every source column name: ClickHouse
    // resolves identifiers inside aggregates to same-name SELECT aliases,
    // turning e.g. max(version) AS version into a nested-aggregate error.
    sql: `
      SELECT
        toString(event_id) AS eventId,
        argMax(event_type, version) AS eventType,
        argMax(body, version) AS latestBody,
        argMax(author_id, version) AS authorId,
        toString(min(event_time)) AS createdAt,
        toString(max(updated_at)) AS lastUpdatedAt,
        max(version) AS latestVersion,
        argMax(deleted, version) AS latestDeleted
      FROM ${ERROR_TRIAGE_EVENTS_TABLE}
      WHERE fingerprint = {fingerprint:String}
      GROUP BY event_id
      HAVING latestDeleted = 0
      ORDER BY createdAt ASC
      LIMIT {limit:UInt32}
    `,
  };
}
