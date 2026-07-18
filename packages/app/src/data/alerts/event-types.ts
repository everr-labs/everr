// The alert.event_type vocabulary CC writes to stored history (the values
// queryAlertEventLog in history.server.ts reads back): instance fire/resolve
// transitions, notification deliveries, rule evaluation health, and the
// dispatcher's silenced-drop audits. A leaf module so client components can
// share the vocabulary without importing the server-only reader.
export const ALERT_EVENT_TYPES = [
  "instance_fired",
  "instance_resolved",
  "delivery",
  "rule_health",
  "silenced",
] as const;

export type AlertEventType = (typeof ALERT_EVENT_TYPES)[number];
