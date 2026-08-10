import { and, eq, lt, ne } from "drizzle-orm";
import { type DbExecutor, db } from "@/db/client";
import { alertDefinitions, alertInstances, previews } from "@/db/schema";
import {
  instanceHistoryRow,
  recordAlertHistory,
  ZERO_UUID,
} from "@/server/alerts/history/clickhouse";
import { uuidv7 } from "@/server/alerts/history/ids";

/**
 * Record that a preview was applied for (org, repoid) and return its id: the
 * registry row is the parent of every preview resource row (they reference it
 * with ON DELETE CASCADE) and backs the switcher and retention job. Re-applies
 * touch lastAppliedAt so active previews never age out. Runs on the caller's
 * executor so registration and the resource writes share one transaction.
 */
export async function upsertPreview(
  exec: DbExecutor,
  opts: { orgId: string; repoid: string; name: string },
): Promise<string> {
  const now = new Date();
  const [row] = await exec
    .insert(previews)
    .values({
      organizationId: opts.orgId,
      repoid: opts.repoid,
      name: opts.name,
      lastAppliedAt: now,
    })
    .onConflictDoUpdate({
      target: [previews.organizationId, previews.repoid, previews.name],
      set: { lastAppliedAt: now },
    })
    .returning({ id: previews.id });
  return row.id;
}

/** The registry row id for an already-applied preview, or null if none exists. */
export async function findPreviewId(
  exec: DbExecutor,
  opts: { orgId: string; repoid: string; name: string },
): Promise<string | null> {
  const [row] = await exec
    .select({ id: previews.id })
    .from(previews)
    .where(
      and(
        eq(previews.organizationId, opts.orgId),
        eq(previews.repoid, opts.repoid),
        eq(previews.name, opts.name),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * Hard-delete previews whose last apply is older than the retention window.
 * Previews are fully reproducible from git (re-applying the branch recreates
 * one), so deletion loses nothing. Resource rows reference the registry row
 * with ON DELETE CASCADE, so this single predicated delete removes them too;
 * the predicate is its own guard, so a concurrent re-apply that refreshes
 * lastAppliedAt is simply not matched. Live rows have no registry row and are
 * never touched.
 *
 * Alert rules also reference the preview row with ON DELETE CASCADE, so their
 * definitions and dependent evaluation state are removed by the same database
 * transaction. Already-queued evaluation jobs safely no-op when their
 * definition no longer exists.
 */
export async function deleteStalePreviews(
  retentionDays: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const now = new Date();
  // Preview alert terminals are projections only, declared ephemeral: the
  // cascade removes the preview's journal rows in this same transaction, so
  // journaling them would leave nothing to repair from. The open set is read
  // under the delete's own transaction and filtered to the previews the
  // predicated delete actually removed, so a concurrent re-apply that rescues
  // a preview never gets a closed row.
  const { deletedIds, closures } = await db.transaction(async (tx) => {
    const open = await tx
      .select({ instance: alertInstances, def: alertDefinitions })
      .from(alertInstances)
      .innerJoin(
        alertDefinitions,
        eq(alertInstances.alertDefinitionId, alertDefinitions.id),
      )
      .innerJoin(previews, eq(alertDefinitions.previewId, previews.id))
      .where(
        and(
          lt(previews.lastAppliedAt, cutoff),
          ne(alertInstances.status, "inactive"),
        ),
      );
    const deleted = await tx
      .delete(previews)
      .where(lt(previews.lastAppliedAt, cutoff))
      .returning({ id: previews.id });
    const removed = new Set(deleted.map((row) => row.id));
    return {
      deletedIds: deleted.map((row) => row.id),
      closures: open.filter(
        ({ def }) => def.previewId !== null && removed.has(def.previewId),
      ),
    };
  });
  if (closures.length > 0) {
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
  return deletedIds.length;
}
