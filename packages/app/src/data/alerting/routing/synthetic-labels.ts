import { AlertingSeveritySchema } from "../schema";

/** Synthetic labels added to every dispatched event. */
export const ALERTING_SYNTHETIC_LABEL_KEYS = [
  "severity",
  "status",
  "rule",
  "kind",
] as const;

type AlertingSyntheticLabelKey = (typeof ALERTING_SYNTHETIC_LABEL_KEYS)[number];

/** Fixed values for synthetic labels. Rule IDs are tenant-specific. */
export const ALERTING_SYNTHETIC_LABEL_VALUES: Partial<
  Record<AlertingSyntheticLabelKey, readonly string[]>
> = {
  severity: AlertingSeveritySchema.options,
  status: ["firing", "resolved"],
  kind: ["alert", "rule_health"],
};
