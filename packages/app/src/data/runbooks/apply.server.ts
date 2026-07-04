import { and, eq } from "drizzle-orm";
import { reconcile } from "@/data/as-code/reconcile";
import type { Reconciler } from "@/data/as-code/registry";
import { previewOwner, previewScope } from "@/data/previews/scope";
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
 * scope is (org, repoid) for live rows and the preview registry id for preview
 * rows, so anything missing from the desired tree is pruned within that scope
 * and other repos'/previews' runbooks are never touched. Writes run on the
 * executor the registry hands in, so the whole apply commits or rolls back as
 * one transaction.
 *
 * Lives in `.server.ts` (not `server.ts`) because it is a plain db-using
 * export; `server.ts` is reachable from the client and would drag `pg` into
 * the bundle.
 */
export const applyRunbookSpecs: Reconciler = async ({
  namespace,
  resources,
  dryRun,
  db: exec,
}): Promise<ApplyRunbooksResult> => {
  const desired = buildDesiredRunbookSet(
    resources.map((r) => ({ path: r.path, document: r.resource })),
  );

  const scope = previewScope(runbooks, namespace);

  const existing = await exec
    .select({
      project: runbooks.project,
      slug: runbooks.slug,
      folderPath: runbooks.folderPath,
      document: runbooks.document,
    })
    .from(runbooks)
    .where(scope);

  const diff = reconcile({ existing, desired });

  const summary: ApplyRunbooksResult = {
    created: diff.creates.map((d) => d.slug),
    updated: diff.updates.map((d) => d.slug),
    deleted: diff.deletes.map((d) => d.slug),
  };

  if (dryRun) return summary;

  for (const d of diff.creates) {
    await exec.insert(runbooks).values({
      organizationId: namespace.orgId,
      ...previewOwner(namespace),
      project: d.project,
      slug: d.slug,
      folderPath: d.folderPath,
      document: d.document as Runbook,
    });
  }
  for (const d of diff.updates) {
    await exec
      .update(runbooks)
      .set({
        document: d.document as Runbook,
        folderPath: d.folderPath,
        updatedAt: new Date(),
      })
      .where(
        and(scope, eq(runbooks.project, d.project), eq(runbooks.slug, d.slug)),
      );
  }
  for (const d of diff.deletes) {
    await exec
      .delete(runbooks)
      .where(
        and(scope, eq(runbooks.project, d.project), eq(runbooks.slug, d.slug)),
      );
  }

  return summary;
};
