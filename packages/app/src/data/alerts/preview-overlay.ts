import type { CcRule } from "@/data/cc/types";
import { fromCcRule, isOwnedRule } from "./mapping";

export type RulePreviewScope = {
  id: string;
  repoid: string;
};

/**
 * CC stores preview alert rules as real, suppressed rules sharing their live
 * counterpart's `name`, distinguished only by `namespace` — the exact
 * analogue of `visibleSlosForPreview`. For read-side surfaces, show the
 * active preview as an overlay over live state: preview rows replace their
 * live counterpart, live rows from covered repos disappear when removed in
 * preview, and preview rows for other preview ids stay hidden. `scopes:
 * null` = no preview selected: live rows only.
 */
export function visibleRulesForPreview<
  T extends Pick<CcRule, "namespace" | "name" | "spec">,
>(rules: readonly T[], scopes: readonly RulePreviewScope[] | null): T[] {
  if (scopes === null) {
    return rules.filter((rule) => fromCcRule(rule).previewId === null);
  }

  const scopeRepoidByPreviewId = new Map(
    scopes.map((scope) => [scope.id, scope.repoid]),
  );
  const coveredRepoids = new Set(scopes.map((scope) => scope.repoid));

  const previewRows = rules.filter((rule) => {
    const view = fromCcRule(rule);
    return (
      view.previewId !== null &&
      isOwnedRule(rule) &&
      scopeRepoidByPreviewId.get(view.previewId) === view.repoid
    );
  });

  const liveRows = rules.filter((rule) => {
    const view = fromCcRule(rule);
    if (view.previewId !== null) return false;
    if (!isOwnedRule(rule)) return true;
    if (!coveredRepoids.has(view.repoid)) return true;
    return false;
  });

  return [...previewRows, ...liveRows];
}
