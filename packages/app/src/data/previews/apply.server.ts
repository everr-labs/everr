import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { alertDefinitions, dashboards, previews, runbooks } from "@/db/schema";

/**
 * Record that a preview was applied for (org, repoid): the registry row backs
 * the web app's switcher and the retention job. Re-applies touch
 * lastAppliedAt so active previews never age out.
 */
export async function upsertPreview(opts: {
  orgId: string;
  repoid: string;
  name: string;
}): Promise<void> {
  const now = new Date();
  await db
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
    });
}

/**
 * Hard-delete previews whose last apply is older than the retention window.
 * Previews are fully reproducible from git (re-applying the branch recreates
 * one), so deletion loses nothing. One transaction per preview so a failure
 * can't leave a preview half-deleted but unregistered.
 */
export async function deleteStalePreviews(
  retentionDays: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const stale = await db
    .select({
      organizationId: previews.organizationId,
      repoid: previews.repoid,
      name: previews.name,
    })
    .from(previews)
    .where(lt(previews.lastAppliedAt, cutoff));

  let removed = 0;
  for (const p of stale) {
    const identity = and(
      eq(previews.organizationId, p.organizationId),
      eq(previews.repoid, p.repoid),
      eq(previews.name, p.name),
    );
    const deleted = await db.transaction(async (tx) => {
      // Re-check under a row lock: a concurrent apply can refresh
      // lastAppliedAt (or delete the preview) between the scan above and here,
      // and deleting on identity alone would drop a now-active preview along
      // with all its resource rows.
      const [locked] = await tx
        .select({ lastAppliedAt: previews.lastAppliedAt })
        .from(previews)
        .where(identity)
        .for("update");
      if (!locked || locked.lastAppliedAt >= cutoff) return false;

      for (const table of [dashboards, runbooks, alertDefinitions]) {
        await tx
          .delete(table)
          .where(
            and(
              eq(table.organizationId, p.organizationId),
              eq(table.repoid, p.repoid),
              eq(table.preview, p.name),
            ),
          );
      }
      await tx.delete(previews).where(identity);
      return true;
    });
    if (deleted) removed += 1;
  }
  return removed;
}
