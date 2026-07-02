import { and, eq } from "drizzle-orm";
import { reconcile } from "@/data/as-code/reconcile";
import type { Reconciler } from "@/data/as-code/registry";
import { db } from "@/db/client";
import { runbooks } from "@/db/schema";
import { buildDesiredRunbookSet } from "./desired";
import type { Runbook } from "./schema";

export interface ApplyRunbooksResult {
  created: string[];
  updated: string[];
  deleted: string[];
}

/**
 * Declarative reconcile core for runbooks; same contract as dashboards: the
 * repoid (from everr.yaml) is the authoritative reconcile scope, existing rows
 * are loaded only for (org, repoid), so anything missing from the desired tree
 * is pruned within the repo — and other repos' runbooks are never touched.
 * Unless dryRun, applies creates/updates/deletes in a single transaction.
 *
 * Lives in `.server.ts` (not `server.ts`) because it is a plain db-using
 * export; `server.ts` is reachable from the client and would drag `pg` into
 * the bundle.
 */
export const applyRunbookSpecs: Reconciler = async ({
  orgId,
  repoid,
  preview,
  resources,
  dryRun,
}): Promise<ApplyRunbooksResult> => {
  const desired = buildDesiredRunbookSet(
    resources.map((r) => ({ path: r.path, document: r.resource })),
  );

  const existing = await db
    .select({
      project: runbooks.project,
      slug: runbooks.slug,
      folderPath: runbooks.folderPath,
      document: runbooks.document,
    })
    .from(runbooks)
    .where(
      and(
        eq(runbooks.organizationId, orgId),
        eq(runbooks.repoid, repoid),
        eq(runbooks.preview, preview),
      ),
    );

  const diff = reconcile({ existing, desired });

  const summary: ApplyRunbooksResult = {
    created: diff.creates.map((d) => d.slug),
    updated: diff.updates.map((d) => d.slug),
    deleted: diff.deletes.map((d) => d.slug),
  };

  if (dryRun) return summary;

  await db.transaction(async (tx) => {
    for (const d of diff.creates) {
      await tx.insert(runbooks).values({
        organizationId: orgId,
        repoid,
        preview,
        project: d.project,
        slug: d.slug,
        folderPath: d.folderPath,
        document: d.document as Runbook,
      });
    }
    for (const d of diff.updates) {
      await tx
        .update(runbooks)
        .set({
          document: d.document as Runbook,
          folderPath: d.folderPath,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(runbooks.organizationId, orgId),
            eq(runbooks.repoid, repoid),
            eq(runbooks.preview, preview),
            eq(runbooks.project, d.project),
            eq(runbooks.slug, d.slug),
          ),
        );
    }
    for (const d of diff.deletes) {
      await tx
        .delete(runbooks)
        .where(
          and(
            eq(runbooks.organizationId, orgId),
            eq(runbooks.repoid, repoid),
            eq(runbooks.preview, preview),
            eq(runbooks.project, d.project),
            eq(runbooks.slug, d.slug),
          ),
        );
    }
  });

  return summary;
};
