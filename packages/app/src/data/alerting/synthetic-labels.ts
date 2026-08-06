import { AlertingSeveritySchema } from "./schema";

/**
 * The synthetic label keys the dispatcher injects, in alerting engine's own order
 * (dispatcher/routing.rs `synthetic_labels`).
 */
export const ALERTING_SYNTHETIC_LABEL_KEYS = [
  "severity",
  "status",
  "rule",
  "kind",
] as const;

export type AlertingSyntheticLabelKey =
  (typeof ALERTING_SYNTHETIC_LABEL_KEYS)[number];

/**
 * `slo` is stamped with the SLO id on SLO-originated events; `slo_tier` is the
 * per-tier instance discriminator.
 * Separate from ALERTING_SYNTHETIC_LABEL_KEYS because those ride on EVERY event,
 * these two only on SLO-originated ones; both are engine-owned vocabulary.
 */
export const ALERTING_SLO_RESERVED_LABEL_KEYS = ["slo", "slo_tier"] as const;

/**
 * Fixed-enum value vocabulary for the synthetic keys. `rule` is deliberately
 * absent: its values are the tenant's rule IDs, resolved live against alerting engine.
 */
export const ALERTING_SYNTHETIC_LABEL_VALUES: Partial<
  Record<AlertingSyntheticLabelKey, readonly string[]>
> = {
  severity: AlertingSeveritySchema.options,
  status: ["firing", "resolved"],
  kind: ["alert", "rule_health"],
};
