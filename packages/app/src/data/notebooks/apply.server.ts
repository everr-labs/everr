import { and, eq } from "drizzle-orm";
import { reconcile } from "@/data/as-code/reconcile";
import type { Reconciler } from "@/data/as-code/registry";
import { db } from "@/db/client";
import { notebooks } from "@/db/schema";
import { buildDesiredNotebookSet } from "./desired";
import type { Notebook } from "./schema";

export interface ApplyNotebooksResult {
  created: string[];
  updated: string[];
  deleted: string[];
}

/**
 * Declarative reconcile core for notebooks; same contract as dashboards: the
 * repoid (from everr.yaml) is the authoritative reconcile scope, existing rows
 * are loaded only for (org, repoid), so anything missing from the desired tree
 * is pruned within the repo — and other repos' notebooks are never touched.
 * Unless dryRun, applies creates/updates/deletes in a single transaction.
 *
 * Lives in `.server.ts` (not `server.ts`) because it is a plain db-using
 * export; `server.ts` is reachable from the client and would drag `pg` into
 * the bundle.
 */
export const applyNotebookSpecs: Reconciler = async ({
  orgId,
  repoid,
  resources,
  dryRun,
}): Promise<ApplyNotebooksResult> => {
  const desired = buildDesiredNotebookSet(
    resources.map((r) => ({ path: r.path, document: r.resource })),
  );

  const existing = await db
    .select({
      project: notebooks.project,
      slug: notebooks.slug,
      folderPath: notebooks.folderPath,
      document: notebooks.document,
    })
    .from(notebooks)
    .where(
      and(eq(notebooks.organizationId, orgId), eq(notebooks.repoid, repoid)),
    );

  const diff = reconcile({ existing, desired });

  const summary: ApplyNotebooksResult = {
    created: diff.creates.map((d) => d.slug),
    updated: diff.updates.map((d) => d.slug),
    deleted: diff.deletes.map((d) => d.slug),
  };

  if (dryRun) return summary;

  await db.transaction(async (tx) => {
    for (const d of diff.creates) {
      await tx.insert(notebooks).values({
        organizationId: orgId,
        repoid,
        project: d.project,
        slug: d.slug,
        folderPath: d.folderPath,
        document: d.document as Notebook,
      });
    }
    for (const d of diff.updates) {
      await tx
        .update(notebooks)
        .set({
          document: d.document as Notebook,
          folderPath: d.folderPath,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(notebooks.organizationId, orgId),
            eq(notebooks.repoid, repoid),
            eq(notebooks.project, d.project),
            eq(notebooks.slug, d.slug),
          ),
        );
    }
    for (const d of diff.deletes) {
      await tx
        .delete(notebooks)
        .where(
          and(
            eq(notebooks.organizationId, orgId),
            eq(notebooks.repoid, repoid),
            eq(notebooks.project, d.project),
            eq(notebooks.slug, d.slug),
          ),
        );
    }
  });

  return summary;
};
