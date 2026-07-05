import { and, eq, isNull } from "drizzle-orm";
import { type OwnershipConflict, partitionByOwnership } from "@/data/as-code/ownership";
import { reconcile } from "@/data/as-code/reconcile";
import type { Reconciler } from "@/data/as-code/registry";
import { foreignLiveScope, previewOwner, previewScope } from "@/data/previews/scope";
import { runbooks } from "@/db/schema";
import { buildDesiredRunbookSet } from "./desired";
import type { Runbook } from "./schema";

export interface ApplyRunbooksResult {
  created: string[];
  updated: string[];
  deleted: string[];
  adopted: string[];
  conflicts: OwnershipConflict[];
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
  adopt,
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

  // A create whose (project, slug) is a live resource owned by another repo is a
  // cross-repo conflict: reported (fail-fast upstream) unless adopting, which
  // transfers ownership. Only live applies can collide.
  const foreign =
    namespace.kind === "live" && diff.creates.length > 0
      ? await exec
          .select({
            project: runbooks.project,
            slug: runbooks.slug,
            owner: runbooks.repoid,
          })
          .from(runbooks)
          .where(foreignLiveScope(runbooks, namespace, diff.creates))
      : [];
  const { freshCreates, takenCreates, adopted, conflicts } = partitionByOwnership(
    diff.creates,
    foreign,
    adopt,
  );

  const summary: ApplyRunbooksResult = {
    created: freshCreates.map((d) => d.slug),
    updated: diff.updates.map((d) => d.slug),
    deleted: diff.deletes.map((d) => d.slug),
    adopted,
    conflicts,
  };

  if (dryRun) return summary;

  for (const d of freshCreates) {
    await exec.insert(runbooks).values({
      organizationId: namespace.orgId,
      ...previewOwner(namespace),
      project: d.project,
      slug: d.slug,
      folderPath: d.folderPath,
      document: d.document as Runbook,
    });
  }
  // Adoption: take over the other repo's live row by its global identity,
  // transferring ownership. Only reached with `adopt` (else the registry aborts).
  for (const d of takenCreates) {
    await exec
      .update(runbooks)
      .set({
        repoid: namespace.repoid,
        document: d.document as Runbook,
        folderPath: d.folderPath,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(runbooks.organizationId, namespace.orgId),
          isNull(runbooks.previewId),
          eq(runbooks.project, d.project),
          eq(runbooks.slug, d.slug),
        ),
      );
  }
  for (const d of diff.updates) {
    await exec
      .update(runbooks)
      .set({
        document: d.document as Runbook,
        folderPath: d.folderPath,
        updatedAt: new Date(),
      })
      .where(and(scope, eq(runbooks.project, d.project), eq(runbooks.slug, d.slug)));
  }
  for (const d of diff.deletes) {
    await exec
      .delete(runbooks)
      .where(and(scope, eq(runbooks.project, d.project), eq(runbooks.slug, d.slug)));
  }

  return summary;
};
