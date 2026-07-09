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
