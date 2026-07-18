// The synthetic-label contract of CC's dispatcher, owned here in the data
// layer so both the data and component layers read the same vocabulary.
import { CcSeveritySchema } from "./schema";

/**
 * The synthetic label keys the dispatcher injects, in CC's own order
 * (dispatcher/routing.rs `synthetic_labels`). The one list every suggestion
 * surface reads, so it cannot drift from the dispatcher's label set.
 */
export const CC_SYNTHETIC_LABEL_KEYS = [
  "severity",
  "status",
  "rule",
  "kind",
] as const;

export type CcSyntheticLabelKey = (typeof CC_SYNTHETIC_LABEL_KEYS)[number];

/**
 * The labels the SLO pipeline reserves, in CC's own order (domain/slo.rs
 * RESERVED_SLO_LABELS): `slo` is the synthetic routing label the dispatcher
 * stamps with the SLO id on every SLO-originated event, and `slo_tier` is the
 * per-tier instance discriminator injected into burn-rate instance labels.
 * Kept separate from CC_SYNTHETIC_LABEL_KEYS: those four ride on EVERY event,
 * these two only on SLO-originated ones — but both sets are engine-owned
 * vocabulary, so suggestion surfaces flag both as synthetic.
 */
export const CC_SLO_RESERVED_LABEL_KEYS = ["slo", "slo_tier"] as const;

/**
 * The engine's own value vocabulary for the synthetic keys whose values are a
 * fixed enum. `rule` is deliberately absent: its values are the tenant's rule
 * IDs (the dispatcher inserts `rule` as the RuleId), resolved live against CC.
 */
export const CC_SYNTHETIC_LABEL_VALUES: Partial<
  Record<CcSyntheticLabelKey, readonly string[]>
> = {
  severity: CcSeveritySchema.options,
  status: ["firing", "resolved"],
  kind: ["alert", "rule_health"],
};
