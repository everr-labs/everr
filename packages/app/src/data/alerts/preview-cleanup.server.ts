import * as cc from "@/data/cc/client";
import { errorMessage, serverLogger } from "@/telemetry/logger";
import { previewIdOf } from "./mapping";

/**
 * Best-effort removal of the suppressed CC rules left behind by deleted
 * previews: list each affected org's rules and delete every one whose
 * everr.preview annotation names a deleted preview id.
 *
 * Called AFTER the preview registry rows are gone. Row-first ordering keeps
 * the Postgres delete authoritative (its predicate already guards against a
 * concurrent re-apply refreshing lastAppliedAt, so we never tear down the CC
 * rules of a preview that just came back to life) and means a CC outage can
 * never block retention. The tradeoff: if CC is unreachable here, the
 * suppressed rules are orphaned (they keep evaluating but never notify) with
 * no automatic retry — we log the org and preview ids so they can be cleaned
 * up manually.
 */
export async function deletePreviewCcRules(
  deleted: readonly { id: string; organizationId: string }[],
): Promise<void> {
  const byOrg = new Map<string, Set<string>>();
  for (const p of deleted) {
    const ids = byOrg.get(p.organizationId) ?? new Set<string>();
    ids.add(p.id);
    byOrg.set(p.organizationId, ids);
  }
  for (const [orgId, previewIds] of byOrg) {
    try {
      const rules = await cc.listRules(orgId);
      for (const rule of rules) {
        const previewId = previewIdOf(rule.spec);
        if (previewId !== null && previewIds.has(previewId)) {
          await cc.deleteRule(orgId, rule.id);
        }
      }
    } catch (error) {
      serverLogger.error("previews.cc_cleanup.failed", {
        "organization.id": orgId,
        "previews.ids": [...previewIds].join(","),
        "error.message": errorMessage(error),
      });
    }
  }
}
