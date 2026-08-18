/**
 * The single source of truth for what `event_type` can hold in ClickHouse.
 *
 * It lives here, in the domain, rather than beside the writer: this module is
 * imported by client-bundled route components, and the writer pulls in
 * server-only dependencies (ClickHouse admin credentials, node:crypto). The
 * writer imports the union from here, so a renamed or removed event type is a
 * compile error at every reader and writer alike, not a silently empty query
 * result.
 */
export type AlertHistoryEventType =
  | "evaluation_succeeded"
  | "evaluation_failed"
  | "instance_pending"
  | "instance_fired"
  | "instance_resolved"
  | "instance_closed"
  | "notification_deferred"
  | "notification_suppressed"
  | "delivery_succeeded"
  | "delivery_failed";

/** `app.alert_events` types that are instance state changes. */
const ALERT_TRANSITION_EVENT_TYPES = [
  "instance_pending",
  "instance_fired",
  "instance_resolved",
  "instance_closed",
] as const satisfies readonly AlertHistoryEventType[];

export type AlertTransitionEventType =
  (typeof ALERT_TRANSITION_EVENT_TYPES)[number];

/**
 * The outcome rows a transition produces in later jobs, correlated back to it
 * by `notification_event_id`. Queryable in ClickHouse and folded into the
 * transition they belong to rather than listed separately in the history UI.
 */
const ALERT_OUTCOME_EVENT_TYPES = [
  "notification_deferred",
  "notification_suppressed",
  "delivery_succeeded",
  "delivery_failed",
] as const satisfies readonly AlertHistoryEventType[];

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
// observed. Keyed over the closed transition list, so a new transition type
// cannot ship without a status.
const ALERT_TRANSITION_STATUS: Record<
  AlertTransitionEventType,
  "pending" | "firing" | "resolved" | "closed"
> = {
  instance_pending: "pending",
  instance_fired: "firing",
  instance_resolved: "resolved",
  instance_closed: "closed",
};

export function alertingEventStatus(
  eventType: string,
): "pending" | "firing" | "resolved" | "closed" | null {
  return isAlertTransitionEventType(eventType)
    ? ALERT_TRANSITION_STATUS[eventType]
    : null;
}

function isAlertTransitionEventType(
  eventType: string,
): eventType is AlertTransitionEventType {
  return (ALERT_TRANSITION_EVENT_TYPES as readonly string[]).includes(
    eventType,
  );
}
