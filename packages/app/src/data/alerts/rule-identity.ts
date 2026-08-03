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
 * Handles an event row may carry for a rule: the id, the first-class `name`
 * (logged as `alert.slug`), and the bare slug — pre-deploy ClickHouse rows
 * stamped `alert.slug` from the old everr.name annotation, which had no
 * project prefix. Passing all three matches every generation of stored row.
 * The bare-slug handle means two projects sharing a slug match the same
 * legacy rows; intentional (matches the old project-agnostic behavior).
 */
export function ccRuleHandles(rule: CcRuleView): string[] {
  const { name, id } = rule;
  if (!name.includes("/")) return [id, name];
  return [id, name, parseResourceName(name).slug];
}
