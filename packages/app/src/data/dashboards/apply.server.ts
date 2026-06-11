import { and, eq, inArray } from "drizzle-orm";
import { ApplyValidationError } from "@/data/as-code/errors";
import { reconcile } from "@/data/as-code/reconcile";
import { db } from "@/db/client";
import { dashboards } from "@/db/schema";
import { buildDesiredSet } from "./desired";
import type { Dashboard } from "./schema";

export interface ApplyDashboardsResult {
  created: string[];
  updated: string[];
  deleted: string[];
  dryRun: boolean;
}

/**
 * Declarative reconcile core for dashboards, shared by the apply route. The
 * declared `projects` (from everr.yaml) are the authoritative reconcile scope —
 * exactly these, with NO implicit "default". Every desired dashboard must
 * belong to a declared project; existing rows are loaded only for declared
 * projects, so anything not in the desired tree (a removed file, the stale side
 * of a cross-project move, the last dashboard of an emptied project) is pruned —
 * and projects this run doesn't declare are never touched (multi-repo safe).
 * Unless dryRun, applies creates/updates/deletes in a single transaction.
 *
 * Lives in `.server.ts` (not `server.ts`) because it is a plain db-using export;
 * `server.ts` is reachable from the client and would drag `pg` into the bundle.
 */
export async function applyDashboardSpecs(opts: {
  orgId: string;
  projects: string[];
  documents: { path: string; document: unknown }[];
  dryRun?: boolean;
}): Promise<ApplyDashboardsResult> {
  const { orgId, projects, documents, dryRun } = opts;

  const desired = buildDesiredSet(documents);

  const scope = [...new Set(projects)];
  const scopeSet = new Set(scope);

  // Every desired dashboard must target a declared project — otherwise its
  // project would be written but never pruned, and a typo'd project would
  // silently orphan rows. A file that omits metadata.project resolves to
  // "default", which must itself be declared.
  for (const d of desired) {
    if (!scopeSet.has(d.project)) {
      throw new ApplyValidationError(
        `dashboard "${d.slug}" targets project "${d.project}", which is not declared in everr.yaml (add it to projects)`,
      );
    }
  }

  const existing =
    scope.length === 0
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
              inArray(dashboards.project, scope),
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
