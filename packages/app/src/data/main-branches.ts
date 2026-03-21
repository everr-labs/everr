import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { mainBranches } from "@/db/schema";

export const DEFAULT_MAIN_BRANCHES = ["main", "master", "develop"] as const;

/**
 * Resolve the branch list for a (tenantId, repository) pair.
 * Resolution order:
 *   1. Repo-specific row (repository = given repo name)
 *   2. Org-wide row (repository IS NULL)
 *   3. Hardcoded fallback: ['main', 'master', 'develop']
 */
export async function getMainBranches(
  tenantId: number,
  repository: string,
): Promise<string[]> {
  const [repoRow] = await db
    .select({ branches: mainBranches.branches })
    .from(mainBranches)
    .where(
      and(
        eq(mainBranches.tenantId, tenantId),
        eq(mainBranches.repository, repository),
      ),
    )
    .limit(1);

  if (repoRow) return repoRow.branches;

  const [orgRow] = await db
    .select({ branches: mainBranches.branches })
    .from(mainBranches)
    .where(
      and(eq(mainBranches.tenantId, tenantId), isNull(mainBranches.repository)),
    )
    .limit(1);

  if (orgRow) return orgRow.branches;

  return [...DEFAULT_MAIN_BRANCHES];
}

/**
 * Get the org-wide default branches for a tenant.
 * Falls back to the hardcoded defaults if no org-wide row exists.
 */
export async function getOrgMainBranches(tenantId: number): Promise<string[]> {
  const [orgRow] = await db
    .select({ branches: mainBranches.branches })
    .from(mainBranches)
    .where(
      and(eq(mainBranches.tenantId, tenantId), isNull(mainBranches.repository)),
    )
    .limit(1);

  return orgRow?.branches ?? [...DEFAULT_MAIN_BRANCHES];
}

/**
 * Upsert the branches array for a specific repo.
 * Throws if branches is empty.
 */
export async function setRepoMainBranches(
  tenantId: number,
  repository: string,
  branches: string[],
): Promise<void> {
  if (branches.length === 0) throw new Error("At least one branch is required");

  await db
    .insert(mainBranches)
    .values({ tenantId, repository, branches })
    .onConflictDoUpdate({
      target: [mainBranches.tenantId, mainBranches.repository],
      set: { branches, updatedAt: new Date() },
    });
}

/**
 * Upsert the org-wide default branches array.
 * Throws if branches is empty.
 */
export async function setOrgMainBranches(
  tenantId: number,
  branches: string[],
): Promise<void> {
  if (branches.length === 0) throw new Error("At least one branch is required");

  // For org-wide rows (repository IS NULL), onConflictDoUpdate can't use the column directly.
  // Use a select-then-upsert approach for clarity:
  const [existing] = await db
    .select({ id: mainBranches.id })
    .from(mainBranches)
    .where(
      and(eq(mainBranches.tenantId, tenantId), isNull(mainBranches.repository)),
    )
    .limit(1);

  if (existing) {
    await db
      .update(mainBranches)
      .set({ branches, updatedAt: new Date() })
      .where(eq(mainBranches.id, existing.id));
  } else {
    await db
      .insert(mainBranches)
      .values({ tenantId, repository: null, branches });
  }
}
