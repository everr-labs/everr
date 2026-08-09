import type { ALERTING_EVENT_TYPES } from "../vocabulary";

export type AlertEventType = (typeof ALERTING_EVENT_TYPES)[number];

/** `app.alert_events` types that are instance state changes. */
const ALERT_TRANSITION_EVENT_TYPES = [
  "instance_pending",
  "instance_fired",
  "instance_resolved",
  "instance_closed",
] as const;

/**
 * The outcome rows a transition produces in later jobs, correlated back to it
 * by `notification_event_id`. Queryable in ClickHouse and folded into the
 * transition they belong to rather than listed separately in the history UI.
 */
const ALERT_OUTCOME_EVENT_TYPES = [
  "notification_suppressed",
  "delivery_succeeded",
  "delivery_failed",
] as const;

function sqlStringList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(", ");
}

export const ALERT_TRANSITION_EVENT_TYPES_SQL = sqlStringList(
  ALERT_TRANSITION_EVENT_TYPES,
);
export const ALERT_OUTCOME_EVENT_TYPES_SQL = sqlStringList(
  ALERT_OUTCOME_EVENT_TYPES,
);

// `instance_closed` gets its own neutral status: it ends the instance without
// notifying, so rendering it as "resolved" would claim a recovery that nobody
// observed.
export function alertingEventStatus(
  eventType: string,
): "pending" | "firing" | "resolved" | "closed" | null {
  switch (eventType) {
    case "instance_pending":
      return "pending";
    case "instance_fired":
      return "firing";
    case "instance_resolved":
      return "resolved";
    case "instance_closed":
      return "closed";
    default:
      return null;
  }
}
