import { and, eq, lt } from "drizzle-orm";
import { type DbExecutor, db } from "@/db/client";
import { previews } from "@/db/schema";

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
 */
export async function deleteStalePreviews(
  retentionDays: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(previews)
    .where(lt(previews.lastAppliedAt, cutoff))
    .returning({ id: previews.id });
  return deleted.length;
}
