import { CcSeveritySchema } from "./schema";

/**
 * The synthetic label keys the dispatcher injects, in CC's own order
 * (dispatcher/routing.rs `synthetic_labels`).
 */
export const CC_SYNTHETIC_LABEL_KEYS = [
  "severity",
  "status",
  "rule",
  "kind",
] as const;

export type CcSyntheticLabelKey = (typeof CC_SYNTHETIC_LABEL_KEYS)[number];

/**
 * Mirrors domain/slo.rs RESERVED_SLO_LABELS: `slo` is stamped with the SLO id
 * on SLO-originated events; `slo_tier` is the per-tier instance discriminator.
 * Separate from CC_SYNTHETIC_LABEL_KEYS because those ride on EVERY event,
 * these two only on SLO-originated ones; both are engine-owned vocabulary.
 */
export const CC_SLO_RESERVED_LABEL_KEYS = ["slo", "slo_tier"] as const;

/**
 * Fixed-enum value vocabulary for the synthetic keys. `rule` is deliberately
 * absent: its values are the tenant's rule IDs, resolved live against CC.
 */
export const CC_SYNTHETIC_LABEL_VALUES: Partial<
  Record<CcSyntheticLabelKey, readonly string[]>
> = {
  severity: CcSeveritySchema.options,
  status: ["firing", "resolved"],
  kind: ["alert", "rule_health"],
};
