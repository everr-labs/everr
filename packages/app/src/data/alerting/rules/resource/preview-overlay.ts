import type { AlertingRule } from "@/data/alerting/types";
import { overlayPreview, type PreviewStatus } from "@/data/previews/overlay";

export type AlertingPreviewScope = {
  id: string;
  repoid: string;
};

type OverlayableRule = Pick<
  AlertingRule,
  "previewId" | "repoid" | "name" | "notification_channels" | "spec"
>;

/**
 * The rules a preview shows, each tagged with how it differs from live. Rules
 * the branch deleted come back tagged "removed" rather than dropped, so a
 * reader sees the deletion instead of a rule that silently vanished. Callers
 * that need only the rules the branch would evaluate must drop those.
 */
export function rulesForPreview<T extends OverlayableRule>(
  rules: readonly T[],
  scopes: readonly AlertingPreviewScope[] | null,
): (T & { previewStatus?: PreviewStatus })[] {
  if (scopes === null) return rules.filter((rule) => rule.previewId === null);

  const repoidByPreviewId = new Map(
    scopes.map((scope) => [scope.id, scope.repoid]),
  );
  // Every preview's rows arrive in one read, so another branch's rule would
  // read as this branch's unless it is dropped here.
  const inScope = rules.filter(
    (rule) =>
      rule.previewId === null ||
      repoidByPreviewId.get(rule.previewId) === rule.repoid,
  );

  return overlayPreview({
    rows: [...inScope],
    coveredRepoids: new Set(scopes.map((scope) => scope.repoid)),
    identity: (rule) => rule.name,
    // A rule's declared content is its spec plus the channels it notifies: the
    // channel list hangs off the definition row, not off the spec, so a branch
    // that only re-routes a rule would otherwise read as unchanged.
    content: (rule) => [rule.spec, rule.notification_channels],
  });
}
