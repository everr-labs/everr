import type { AlertingSlo } from "@/data/alerting/types";
import { fromAlertingSlo, isOwnedSlo } from "./mapping";

export type SloPreviewScope = {
  id: string;
  repoid: string;
};

/**
 * Preview SLOs are real, suppressed SLOs sharing their live counterpart's
 * `name` and carrying an explicit `previewId`. For read-side surfaces, show
 * the active preview as an overlay over live state: preview
 * rows replace their live counterpart, live rows from covered repos
 * disappear when removed in preview, and preview rows for other preview ids
 * stay hidden.
 */
export function visibleSlosForPreview<T extends AlertingSlo>(
  slos: readonly T[],
  scopes: readonly SloPreviewScope[] | null,
): T[] {
  if (scopes === null) {
    return slos.filter((slo) => fromAlertingSlo(slo).previewId === null);
  }

  const scopeRepoidByPreviewId = new Map(
    scopes.map((scope) => [scope.id, scope.repoid]),
  );
  const coveredRepoids = new Set(scopes.map((scope) => scope.repoid));

  const previewRows = slos.filter((slo) => {
    const view = fromAlertingSlo(slo);
    return (
      view.previewId !== null &&
      isOwnedSlo(slo) &&
      scopeRepoidByPreviewId.get(view.previewId) === view.repoid
    );
  });

  const liveRows = slos.filter((slo) => {
    const view = fromAlertingSlo(slo);
    if (view.previewId !== null) return false;
    if (!isOwnedSlo(slo)) return true;
    if (!coveredRepoids.has(view.repoid)) return true;
    return false;
  });

  return [...previewRows, ...liveRows];
}
