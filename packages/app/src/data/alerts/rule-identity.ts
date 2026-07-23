// packages/app/src/data/alerts/rule-identity.ts
//
// One resolution of "what do we call this rule, and where's its runbook" for
// every alerting surface (rules list, rule detail, triage): the display-name
// annotation first, then the as-code slug (always present, carried on the
// rule's own first-class `name`); the runbook link from the canonical
// `everr.runbook` annotation.
import { parseResourceName } from "@/data/as-code/identity";
import type { CcRuleView } from "@/data/cc/types";
import { fromCcRule } from "./mapping";

export type CcRuleIdentity = {
  /** Human name: displayName || slug. */
  name: string;
  shortId: string;
  project: string;
  /** The as-code slug, split off the rule's first-class `name`. */
  slug: string;
  /** /runbooks/$project/$slug params when the rule links a runbook. */
  runbook: { project: string; slug: string } | null;
};

export function ccRuleIdentity(rule: CcRuleView): CcRuleIdentity {
  const view = fromCcRule(rule);
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

/**
 * The handles an event row may carry for a rule: the rule's first-class
 * `name` (what CC now logs as `alert.slug`) and the bare rule id. Callers
 * scoping an event feed to one rule pass both, so either handle matches.
 */
export function ccRuleHandles(rule: CcRuleView): string[] {
  return [rule.id, rule.name];
}

/**
 * Resolve event-row rule handles (the rule's first-class name, or its bare
 * id) against a set of rules: the display name for the Rule column, the
 * rule's severity as the fallback for records stored before CC stamped
 * `alert.severity`, and the rule's `{ project, slug }` address for building
 * links. The one mechanism behind both the history feed (all rules) and the
 * rule-detail timeline (a single rule); unknown handles resolve to
 * themselves / nothing, and render as plain text rather than links.
 */
export function ccRuleHandleResolvers(rules: readonly CcRuleView[]): {
  resolveRuleName: (handle: string) => string;
  resolveRuleSeverity: (handle: string) => string | undefined;
  resolveRuleId: (handle: string) => string | undefined;
  resolveRuleAddress: (
    handle: string,
  ) => { project: string; slug: string } | undefined;
} {
  const nameByHandle = new Map<string, string>();
  const severityByHandle = new Map<string, string>();
  const idByHandle = new Map<string, string>();
  const addressByHandle = new Map<string, { project: string; slug: string }>();
  for (const rule of rules) {
    const { name, project, slug } = ccRuleIdentity(rule);
    for (const handle of ccRuleHandles(rule)) {
      nameByHandle.set(handle, name);
      severityByHandle.set(handle, rule.spec.severity);
      idByHandle.set(handle, rule.id);
      addressByHandle.set(handle, { project, slug });
    }
  }
  return {
    resolveRuleName: (handle) => nameByHandle.get(handle) ?? handle,
    resolveRuleSeverity: (handle) => severityByHandle.get(handle),
    resolveRuleId: (handle) => idByHandle.get(handle),
    resolveRuleAddress: (handle) => addressByHandle.get(handle),
  };
}
