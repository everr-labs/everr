import type { AlertingRuleView } from "@/data/alerting/types";
import { parseResourceName } from "@/data/as-code/identity";
import { fromAlertingRule } from "./resource/mapping";

export type AlertingRuleIdentity = {
  /** Human name: displayName || slug. */
  name: string;
  shortId: string;
  project: string;
  /** The as-code slug, split off the rule's first-class `name`. */
  slug: string;
  /** /runbooks/$project/$slug params when the rule links a runbook. */
  runbook: { project: string; slug: string } | null;
};

export function alertingRuleIdentity(
  rule: AlertingRuleView,
): AlertingRuleIdentity {
  const view = fromAlertingRule(rule);
  const { project, slug } = parseResourceName(rule.name);
  return {
    name: view.displayName || slug,
    shortId: rule.id.slice(0, 8),
    project,
    slug,
    runbook: view.runbookSlug
      ? { project: view.runbookProject ?? "default", slug: view.runbookSlug }
      : null,
  };
}

/** The canonical event-log slug for a rule. */
export function alertingRuleHandles(rule: AlertingRuleView): string[] {
  return [rule.name];
}
