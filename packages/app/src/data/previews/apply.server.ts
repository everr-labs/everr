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

  for (const p of stale) {
    await db.transaction(async (tx) => {
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
      await tx
        .delete(previews)
        .where(
          and(
            eq(previews.organizationId, p.organizationId),
            eq(previews.repoid, p.repoid),
            eq(previews.name, p.name),
          ),
        );
    });
  }
  return stale.length;
}
