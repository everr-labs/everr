import {
  ERROR_EVENT_FINGERPRINT_ATTR,
  ERROR_EVENT_TYPE_ATTR,
  ERROR_TRIAGE_EVENT_TYPES,
} from "../events";
import type { BuiltQuery } from "./issues";
import { validateTableName } from "./table";

// Full history for the Fingerprint, deliberately unbounded by the page's time
// range: the timeline (and later, status derivation) must see every triage
// event still inside log retention. Tenant scoping comes from the row-level
// policy on the logs table.
export function buildTriageEventsQuery(
  input: { fingerprint: string; limit: number },
  tableName: string,
): BuiltQuery {
  validateTableName(tableName);
  return {
    params: {
      fingerprint: input.fingerprint,
      eventTypes: [...ERROR_TRIAGE_EVENT_TYPES],
      limit: input.limit,
    },
    sql: `
      SELECT
        toString(Timestamp) AS timestamp,
        LogAttributes['${ERROR_EVENT_TYPE_ATTR}'] AS eventType,
        Body AS body,
        LogAttributes AS logAttributes
      FROM ${tableName}
      WHERE LogAttributes['${ERROR_EVENT_FINGERPRINT_ATTR}'] = {fingerprint:String}
        AND LogAttributes['${ERROR_EVENT_TYPE_ATTR}'] IN {eventTypes:Array(String)}
      ORDER BY Timestamp ASC
      LIMIT {limit:UInt32}
    `,
  };
}
