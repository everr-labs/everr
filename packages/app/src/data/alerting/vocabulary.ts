export const ALERTING_SEVERITIES = ["info", "warning", "critical"] as const;

export const ALERTING_INSTANCE_STATUSES = [
  "inactive",
  "pending",
  "firing",
] as const;

export const ALERTING_HEALTH_STATUSES = ["healthy", "degraded"] as const;

export const ALERTING_EVENT_TYPES = [
  "instance_fired",
  "instance_resolved",
  "delivery",
  "rule_health",
  "silenced",
] as const;
