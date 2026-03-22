import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { mainBranches } from "@/db/schema";

export const DEFAULT_MAIN_BRANCHES = ["main", "master", "develop"] as const;

function validateBranches(branches: string[]): void {
  if (branches.length === 0 || branches.some((b) => b.trim().length === 0)) {
    throw new Error("All branch names must be non-empty strings");
  }
}

/**
 * Resolve the branch list for a (tenantId, repository) pair.
 * Resolution order:
 *   1. Repo-specific row (repository = given repo name)
 *   2. Org-wide row (repository IS NULL)
 *   3. Hardcoded fallback: ['main', 'master', 'develop']
 *
 * Fetches both candidates in a single query; Postgres sorts non-null
 * repository values before NULL for ASC ordering, so the repo-specific
 * row naturally wins when both exist.
 */
export async function getMainBranches(
  tenantId: number,
  repository: string,
): Promise<string[]> {
  const rows = await db
    .select({ branches: mainBranches.branches })
    .from(mainBranches)
    .where(
      and(
        eq(mainBranches.tenantId, tenantId),
        or(
          eq(mainBranches.repository, repository),
          isNull(mainBranches.repository),
        ),
      ),
    )
    .orderBy(asc(mainBranches.repository)) // non-null sorts before NULL (NULLS LAST)
    .limit(2);

  return rows[0]?.branches ?? [...DEFAULT_MAIN_BRANCHES];
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
 * Throws if branches is empty or contains blank names.
 */
export async function setRepoMainBranches(
  tenantId: number,
  repository: string,
  branches: string[],
): Promise<void> {
  validateBranches(branches);

  await db
    .insert(mainBranches)
    .values({ tenantId, repository, branches })
    .onConflictDoUpdate({
      target: [mainBranches.tenantId, mainBranches.repository],
      set: { branches, updatedAt: sql`now()` },
    });
}

/**
 * Upsert the org-wide default branches array.
 * Throws if branches is empty or contains blank names.
 */
export async function setOrgMainBranches(
  tenantId: number,
  branches: string[],
): Promise<void> {
  validateBranches(branches);

  // NULL columns cannot be used as onConflictDoUpdate targets directly —
  // targetWhere references the partial unique index instead.
  await db
    .insert(mainBranches)
    .values({ tenantId, repository: null, branches })
    .onConflictDoUpdate({
      target: mainBranches.tenantId,
      targetWhere: isNull(mainBranches.repository),
      set: { branches, updatedAt: sql`now()` },
    });
}
