import { and, eq } from "drizzle-orm";
import { reconcile } from "@/data/as-code/reconcile";
import type { Reconciler } from "@/data/as-code/registry";
import { previewOwner, previewScope } from "@/data/previews/scope";
import { dashboards } from "@/db/schema";
import { buildDesiredSet } from "./desired";
import type { Dashboard } from "./schema";

export interface ApplyDashboardsResult {
  created: string[];
  updated: string[];
  deleted: string[];
}

/**
 * Declarative reconcile core for dashboards. The reconcile scope is (org, repoid)
 * for live rows and the preview registry id for preview rows: existing rows are
 * loaded only within that scope, so anything missing from the desired tree is
 * pruned within it — and other repos'/previews' dashboards are never touched.
 * Writes run on the executor the registry hands in, so the whole apply (register
 * + every kind) commits or rolls back as one transaction.
 *
 * Lives in `.server.ts` (not `server.ts`) because it is a plain db-using export;
 * `server.ts` is reachable from the client and would drag `pg` into the bundle.
 */
export const applyDashboardSpecs: Reconciler = async ({
  namespace,
  resources,
  dryRun,
  db: exec,
}): Promise<ApplyDashboardsResult> => {
  const desired = buildDesiredSet(
    resources.map((r) => ({ path: r.path, document: r.resource })),
  );

  const scope = previewScope(dashboards, namespace);

  const existing = await exec
    .select({
      project: dashboards.project,
      slug: dashboards.slug,
      folderPath: dashboards.folderPath,
      document: dashboards.document,
    })
    .from(dashboards)
    .where(scope);

  const diff = reconcile({ existing, desired });

  const summary: ApplyDashboardsResult = {
    created: diff.creates.map((d) => d.slug),
    updated: diff.updates.map((d) => d.slug),
    deleted: diff.deletes.map((d) => d.slug),
  };

  if (dryRun) return summary;

  for (const d of diff.creates) {
    await exec.insert(dashboards).values({
      organizationId: namespace.orgId,
      ...previewOwner(namespace),
      project: d.project,
      slug: d.slug,
      folderPath: d.folderPath,
      document: d.document as Dashboard,
    });
  }
  for (const d of diff.updates) {
    await exec
      .update(dashboards)
      .set({
        document: d.document as Dashboard,
        folderPath: d.folderPath,
        updatedAt: new Date(),
      })
      .where(
        and(
          scope,
          eq(dashboards.project, d.project),
          eq(dashboards.slug, d.slug),
        ),
      );
  }
  for (const d of diff.deletes) {
    await exec
      .delete(dashboards)
      .where(
        and(
          scope,
          eq(dashboards.project, d.project),
          eq(dashboards.slug, d.slug),
        ),
      );
  }

  return summary;
};
