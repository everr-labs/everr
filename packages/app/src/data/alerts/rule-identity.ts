// packages/app/src/data/alerts/rule-identity.ts
//
// One resolution of "what do we call this rule, and where's its runbook" for
// every alerting surface (rules list, rule detail, triage): the display-name
// annotation first, then the as-code slug, then the short id; the runbook
// link from the canonical `everr.runbook` annotation.
import type { CcRuleView } from "@/data/cc/types";
import { fromCcRuleSpec } from "./mapping";

export type CcRuleIdentity = {
  /** Human name: displayName || slug || short id. */
  name: string;
  shortId: string;
  /** The as-code slug (`everr.name`), null for engine-only rules. */
  slug: string | null;
  /** /runbooks/$project/$slug params when the rule links a runbook. */
  runbook: { project: string; slug: string } | null;
};

export function ccRuleIdentity(rule: CcRuleView): CcRuleIdentity {
  const view = fromCcRuleSpec(rule.spec);
  const shortId = rule.id.slice(0, 8);
  return {
    name: view.displayName || view.slug || shortId,
    shortId,
    slug: view.slug || null,
    runbook: view.runbookSlug
      ? { project: view.runbookProject ?? "default", slug: view.runbookSlug }
      : null,
  };
}

/**
 * The handles an event row may carry for a rule: its as-code slug when CC
 * knows it, and the bare rule id otherwise. Callers scoping an event feed to
 * one rule pass both, so either handle matches.
 */
export function ccRuleHandles(rule: CcRuleView): string[] {
  const { slug } = ccRuleIdentity(rule);
  return slug ? [rule.id, slug] : [rule.id];
}

/**
 * Resolve event-row rule handles (slug or bare rule id) against a set of
 * rules: the display name for the Rule column, and the rule's severity as
 * the fallback for records stored before CC stamped `alert.severity`. The
 * one mechanism behind both the history feed (all rules) and the rule-detail
 * timeline (a single rule); unknown handles resolve to themselves / nothing.
 */
export function ccRuleHandleResolvers(rules: readonly CcRuleView[]): {
  resolveRuleName: (handle: string) => string;
  resolveRuleSeverity: (handle: string) => string | undefined;
} {
  const nameByHandle = new Map<string, string>();
  const severityByHandle = new Map<string, string>();
  for (const rule of rules) {
    const { name } = ccRuleIdentity(rule);
    for (const handle of ccRuleHandles(rule)) {
      nameByHandle.set(handle, name);
      severityByHandle.set(handle, rule.spec.severity);
    }
  }
  return {
    resolveRuleName: (handle) => nameByHandle.get(handle) ?? handle,
    resolveRuleSeverity: (handle) => severityByHandle.get(handle),
  };
}
