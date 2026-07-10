import type { BuiltQuery } from "./issues";
import { ERROR_TRIAGE_EVENTS_TABLE } from "./table";

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
