import { and, eq } from "drizzle-orm";
import { reconcile } from "@/data/as-code/reconcile";
import type { Reconciler } from "@/data/as-code/registry";
import { db } from "@/db/client";
import { dashboards } from "@/db/schema";
import { buildDesiredSet } from "./desired";
import type { Dashboard } from "./schema";

export interface ApplyDashboardsResult {
  created: string[];
  updated: string[];
  deleted: string[];
}

/**
 * Declarative reconcile core for dashboards. The repoid (from everr.yaml) is
 * the authoritative reconcile scope: existing rows are loaded only for
 * (org, repoid), so anything missing from the desired tree is pruned within
 * the repo — and other repos' dashboards are never touched.
 * Unless dryRun, applies creates/updates/deletes in a single transaction.
 *
 * Lives in `.server.ts` (not `server.ts`) because it is a plain db-using export;
 * `server.ts` is reachable from the client and would drag `pg` into the bundle.
 */
export const applyDashboardSpecs: Reconciler = async ({
  orgId,
  repoid,
  resources,
  dryRun,
}): Promise<ApplyDashboardsResult> => {
  const desired = buildDesiredSet(
    resources.map((r) => ({ path: r.path, document: r.resource })),
  );

  const existing = await db
    .select({
      project: dashboards.project,
      slug: dashboards.slug,
      folderPath: dashboards.folderPath,
      document: dashboards.document,
    })
    .from(dashboards)
    .where(
      and(eq(dashboards.organizationId, orgId), eq(dashboards.repoid, repoid)),
    );

  const diff = reconcile({ existing, desired });

  const summary: ApplyDashboardsResult = {
    created: diff.creates.map((d) => d.slug),
    updated: diff.updates.map((d) => d.slug),
    deleted: diff.deletes.map((d) => d.slug),
  };

  if (dryRun) return summary;

  await db.transaction(async (tx) => {
    for (const d of diff.creates) {
      await tx.insert(dashboards).values({
        organizationId: orgId,
        repoid,
        project: d.project,
        slug: d.slug,
        folderPath: d.folderPath,
        document: d.document as Dashboard,
      });
    }
    for (const d of diff.updates) {
      await tx
        .update(dashboards)
        .set({
          document: d.document as Dashboard,
          folderPath: d.folderPath,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(dashboards.organizationId, orgId),
            eq(dashboards.repoid, repoid),
            eq(dashboards.project, d.project),
            eq(dashboards.slug, d.slug),
          ),
        );
    }
    for (const d of diff.deletes) {
      await tx
        .delete(dashboards)
        .where(
          and(
            eq(dashboards.organizationId, orgId),
            eq(dashboards.repoid, repoid),
            eq(dashboards.project, d.project),
            eq(dashboards.slug, d.slug),
          ),
        );
    }
  });

  return summary;
};
