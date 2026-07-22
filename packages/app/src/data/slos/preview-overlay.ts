import type { CcSlo } from "@/data/cc/types";
import { fromCcSloSpec } from "./mapping";

export type SloPreviewScope = {
  id: string;
  repoid: string;
};

export function withAuthoredSloName<T extends CcSlo>(slo: T): T {
  const slug = fromCcSloSpec(slo.spec).slug;
  return slug !== "" && slo.name !== slug ? { ...slo, name: slug } : slo;
}

/**
 * CC stores preview SLOs as real, suppressed SLOs under tenant-unique
 * `*.pv-*` names. For read-side surfaces, show the active preview as an
 * overlay over live state: preview rows replace their live counterpart, live
 * rows from covered repos disappear when removed in preview, and preview rows
 * for other preview names stay hidden.
 */
export function visibleSlosForPreview<T extends CcSlo>(
  slos: readonly T[],
  scopes: readonly SloPreviewScope[] | null,
): T[] {
  if (scopes === null) {
    return slos
      .filter((slo) => fromCcSloSpec(slo.spec).previewId === null)
      .map(withAuthoredSloName);
  }

  const scopeRepoidByPreviewId = new Map(
    scopes.map((scope) => [scope.id, scope.repoid]),
  );
  const coveredRepoids = new Set(scopes.map((scope) => scope.repoid));

  const previewRows = slos.filter((slo) => {
    const view = fromCcSloSpec(slo.spec);
    return (
      view.previewId !== null &&
      view.slug !== "" &&
      scopeRepoidByPreviewId.get(view.previewId) === view.repoid
    );
  });

  const liveRows = slos.filter((slo) => {
    const view = fromCcSloSpec(slo.spec);
    if (view.previewId !== null) return false;
    if (view.slug === "") return true;
    if (!coveredRepoids.has(view.repoid)) return true;
    return false;
  });

  return [...previewRows, ...liveRows].map(withAuthoredSloName);
}
