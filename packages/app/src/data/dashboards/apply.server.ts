import { and, eq, isNull } from "drizzle-orm";
import { type OwnershipConflict, partitionByOwnership } from "@/data/as-code/ownership";
import { reconcile } from "@/data/as-code/reconcile";
import type { Reconciler } from "@/data/as-code/registry";
import { foreignLiveScope, previewOwner, previewScope } from "@/data/previews/scope";
import { dashboards } from "@/db/schema";
import { buildDesiredSet } from "./desired";
import type { Dashboard } from "./schema";

export interface ApplyDashboardsResult {
  created: string[];
  updated: string[];
  deleted: string[];
  adopted: string[];
  conflicts: OwnershipConflict[];
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
  adopt,
  db: exec,
}): Promise<ApplyDashboardsResult> => {
  const desired = buildDesiredSet(resources.map((r) => ({ path: r.path, document: r.resource })));

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

  // A create whose (project, slug) is a live resource owned by another repo is a
  // cross-repo conflict: reported (fail-fast upstream) unless adopting, in which
  // case we transfer ownership. Only live applies can collide.
  const foreign =
    namespace.kind === "live" && diff.creates.length > 0
      ? await exec
          .select({
            project: dashboards.project,
            slug: dashboards.slug,
            owner: dashboards.repoid,
          })
          .from(dashboards)
          .where(foreignLiveScope(dashboards, namespace, diff.creates))
      : [];
  const { freshCreates, takenCreates, adopted, conflicts } = partitionByOwnership(
    diff.creates,
    foreign,
    adopt,
  );

  const summary: ApplyDashboardsResult = {
    created: freshCreates.map((d) => d.slug),
    updated: diff.updates.map((d) => d.slug),
    deleted: diff.deletes.map((d) => d.slug),
    adopted,
    conflicts,
  };

  if (dryRun) return summary;

  for (const d of freshCreates) {
    await exec.insert(dashboards).values({
      organizationId: namespace.orgId,
      ...previewOwner(namespace),
      project: d.project,
      slug: d.slug,
      folderPath: d.folderPath,
      // The reconciler carries documents as opaque `unknown`; the jsonb column is
      // typed `Dashboard` and there is no runtime guard for the full spec shape.
      // oxlint-disable-next-line typescript/consistent-type-assertions -- unknown reconcile document bridged to typed jsonb column
      document: d.document as Dashboard,
    });
  }
  // Adoption: take over the other repo's live row by its global identity,
  // transferring ownership and applying the desired content. Only reached with
  // `adopt` (otherwise the registry aborts on the conflict before any write).
  for (const d of takenCreates) {
    await exec
      .update(dashboards)
      .set({
        repoid: namespace.repoid,
        // oxlint-disable-next-line typescript/consistent-type-assertions -- unknown reconcile document bridged to typed jsonb column
        document: d.document as Dashboard,
        folderPath: d.folderPath,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(dashboards.organizationId, namespace.orgId),
          isNull(dashboards.previewId),
          eq(dashboards.project, d.project),
          eq(dashboards.slug, d.slug),
        ),
      );
  }
  for (const d of diff.updates) {
    await exec
      .update(dashboards)
      .set({
        // oxlint-disable-next-line typescript/consistent-type-assertions -- unknown reconcile document bridged to typed jsonb column
        document: d.document as Dashboard,
        folderPath: d.folderPath,
        updatedAt: new Date(),
      })
      .where(and(scope, eq(dashboards.project, d.project), eq(dashboards.slug, d.slug)));
  }
  for (const d of diff.deletes) {
    await exec
      .delete(dashboards)
      .where(and(scope, eq(dashboards.project, d.project), eq(dashboards.slug, d.slug)));
  }

  return summary;
};
