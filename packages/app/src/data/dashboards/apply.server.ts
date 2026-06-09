import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { dashboards } from "@/db/schema";
import { buildDesiredSet } from "./desired";
import { reconcile } from "./reconcile";
import type { Dashboard } from "./schema";

export interface ApplyDashboardsResult {
  created: string[];
  updated: string[];
  deleted: string[];
  dryRun: boolean;
}

/**
 * Declarative reconcile core for dashboards, shared by the apply route. The
 * desired set may span multiple projects; existing rows are loaded ONLY for the
 * projects present in this run, so projects not in the run are never pruned.
 * Identity is (org, project, slug). Unless dryRun, applies creates/updates/
 * deletes in a single transaction.
 *
 * Lives in `.server.ts` (not `server.ts`) because it is a plain db-using export;
 * `server.ts` is reachable from the client and would drag `pg` into the bundle.
 */
export async function applyDashboardSpecs(opts: {
  orgId: string;
  documents: { path: string; document: unknown }[];
  dryRun?: boolean;
}): Promise<ApplyDashboardsResult> {
  const { orgId, documents, dryRun } = opts;

  const desired = buildDesiredSet(documents);
  const projectsInRun = [...new Set(desired.map((d) => d.project))];

  const existing =
    projectsInRun.length === 0
      ? []
      : await db
          .select({
            project: dashboards.project,
            slug: dashboards.slug,
            folderPath: dashboards.folderPath,
            document: dashboards.document,
          })
          .from(dashboards)
          .where(
            and(
              eq(dashboards.organizationId, orgId),
              inArray(dashboards.project, projectsInRun),
            ),
          );

  const diff = reconcile({ existing, desired });

  const summary: ApplyDashboardsResult = {
    created: diff.creates.map((d) => d.slug),
    updated: diff.updates.map((d) => d.slug),
    deleted: diff.deletes.map((d) => d.slug),
    dryRun: dryRun ?? false,
  };

  if (dryRun) return summary;

  await db.transaction(async (tx) => {
    for (const d of diff.creates) {
      await tx.insert(dashboards).values({
        organizationId: orgId,
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
            eq(dashboards.project, d.project),
            eq(dashboards.slug, d.slug),
          ),
        );
    }
  });

  return summary;
}
