import type { AlertingRule } from "@/data/alerting/types";
import { fromAlertingRule } from "./mapping";

export type RulePreviewScope = {
  id: string;
  repoid: string;
};

/**
 * Preview alert rules are real, suppressed rules sharing their live
 * counterpart's `name`, distinguished by `previewId`, the exact
 * analogue of `visibleSlosForPreview`. For read-side surfaces, show the
 * active preview as an overlay over live state: preview rows replace their
 * live counterpart, live rows from covered repos disappear when removed in
 * preview, and preview rows for other preview ids stay hidden. `scopes:
 * null` = no preview selected: live rows only.
 */
export function visibleRulesForPreview<
  T extends Pick<
    AlertingRule,
    "previewId" | "repoid" | "name" | "notification_channels" | "spec"
  >,
>(rules: readonly T[], scopes: readonly RulePreviewScope[] | null): T[] {
  if (scopes === null) {
    return rules.filter((rule) => fromAlertingRule(rule).previewId === null);
  }

  const scopeRepoidByPreviewId = new Map(
    scopes.map((scope) => [scope.id, scope.repoid]),
  );
  const coveredRepoids = new Set(scopes.map((scope) => scope.repoid));

  const previewRows = rules.filter((rule) => {
    const view = fromAlertingRule(rule);
    return (
      view.previewId !== null &&
      scopeRepoidByPreviewId.get(view.previewId) === view.repoid
    );
  });

  const liveRows = rules.filter((rule) => {
    const view = fromAlertingRule(rule);
    if (view.previewId !== null) return false;
    if (!coveredRepoids.has(view.repoid)) return true;
    return false;
  });

  return [...previewRows, ...liveRows];
}
