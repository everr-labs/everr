// Shared CC alert history event types.
export const ALERT_EVENT_TYPES = [
  "instance_fired",
  "instance_resolved",
  "delivery",
  "rule_health",
  "silenced",
] as const;

export type AlertEventType = (typeof ALERT_EVENT_TYPES)[number];
