import { and, eq, lt, ne } from "drizzle-orm";
import type { DbExecutor } from "@/db/client";
import { alertDefinitions, alertInstances, previews } from "@/db/schema";
import {
  instanceHistoryRow,
  recordAlertHistory,
  ZERO_UUID,
} from "./clickhouse";
import { uuidv7 } from "./ids";

export type PreviewInstanceClosure = {
  instance: typeof alertInstances.$inferSelect;
  def: typeof alertDefinitions.$inferSelect;
};

/**
 * The open alert instances whose preview is older than the cutoff. Must run
 * inside the retention delete's transaction, before the cascade removes the
 * definitions and instances together with their preview.
 */
export async function openPreviewAlertInstances(
  tx: DbExecutor,
  stalerThan: Date,
): Promise<PreviewInstanceClosure[]> {
  return tx
    .select({ instance: alertInstances, def: alertDefinitions })
    .from(alertInstances)
    .innerJoin(
      alertDefinitions,
      eq(alertInstances.alertDefinitionId, alertDefinitions.id),
    )
    .innerJoin(previews, eq(alertDefinitions.previewId, previews.id))
    .where(
      and(
        lt(previews.lastAppliedAt, stalerThan),
        ne(alertInstances.status, "inactive"),
      ),
    );
}

/**
 * Close the torn-down preview's open instances in the history surface.
 * Projections only, declared ephemeral: the cascade removed the preview's
 * journal rows in the same transaction, so journaling these terminals would
 * leave nothing to repair from.
 */
export async function recordPreviewTeardownClosures(
  closures: PreviewInstanceClosure[],
  now: Date,
): Promise<void> {
  if (closures.length === 0) return;
  await recordAlertHistory(
    null,
    closures.map(({ instance, def }) =>
      instanceHistoryRow({
        def: {
          id: def.id,
          organizationId: def.organizationId,
          repoid: def.repoid,
          slug: `${def.project}/${def.slug}`,
          previewId: def.previewId,
          severity: def.spec.severity,
          ruleMuted: true,
        },
        eventId: uuidv7(now),
        eventType: "instance_closed",
        occurredAt: now,
        episodeId: instance.episodeId ?? ZERO_UUID,
        fingerprint: instance.fingerprint,
        labels: instance.labels,
        evidence: {},
        evidenceTruncated: false,
        contextJson: "{}",
        reason: "preview_deleted",
      }),
    ),
  );
}
