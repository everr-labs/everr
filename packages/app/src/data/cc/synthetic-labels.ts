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
