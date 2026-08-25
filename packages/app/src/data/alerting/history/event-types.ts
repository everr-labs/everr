/**
 * The single source of truth for what `event_type` can hold in ClickHouse.
 *
 * It lives in the domain rather than beside the writer, because
 * client-bundled route components import this module, and the writer pulls in
 * server-only dependencies.
 *
 * The writer imports the union from here, so a renamed or removed event type
 * is a compile error at every reader and writer, not a silently empty query
 * result.
 */
export const ALERT_HISTORY_EVENT_TYPES = [
  "evaluation_succeeded",
  "evaluation_failed",
  "instance_pending",
  "instance_fired",
  "instance_resolved",
  "instance_closed",
  "notification_deferred",
  "notification_suppressed",
  "delivery_succeeded",
  "delivery_failed",
] as const;

export type AlertHistoryEventType = (typeof ALERT_HISTORY_EVENT_TYPES)[number];
