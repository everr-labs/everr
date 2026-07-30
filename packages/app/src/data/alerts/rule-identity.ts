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
 * The handles an event row may carry for a rule: the bare rule id, the
 * rule's first-class `name` (what CC now logs as `alert.slug`), and, when
 * that name is qualified ("project/slug"), the bare slug too — pre-deploy
 * ClickHouse rows stamped `alert.slug` from the old everr.name annotation,
 * which never carried a project prefix. Callers scoping an event feed to one
 * rule pass all three, so any generation of stored row matches. Restoring
 * the bare-slug handle also restores the pre-branch ambiguity where two
 * projects sharing a slug both match the same legacy rows; that is
 * intentional (it matches the old, project-agnostic behavior) rather than a
 * regression.
 */
export function ccRuleHandles(rule: CcRuleView): string[] {
  const { name, id } = rule;
  if (!name.includes("/")) return [id, name];
  return [id, name, parseResourceName(name).slug];
}
