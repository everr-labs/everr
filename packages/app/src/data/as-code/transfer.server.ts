import { and, eq, notInArray } from "drizzle-orm";
import { previewScope } from "@/data/previews/scope";
import type { DbExecutor } from "@/db/client";
import { alertDefinitions, dashboards, previews, runbooks } from "@/db/schema";

export interface TransferredSlugs {
  dashboards: string[];
  runbooks: string[];
  alerts: string[];
}

/**
 * Relabel everything `from` owns in this org to `to`: the whole-boundary
 * ownership transfer behind `everr apply --transfer-from` (repo rename,
 * legacy-manifest removal). A pure repoid rewrite: documents, folder paths,
 * and alert runtime state ride along untouched, so a transferred alert never
 * flaps back to unknown. Live (project, slug) identities are org-unique
 * regardless of repoid (see the dashboards_live_project_slug_uq comment), so
 * live rows cannot collide with rows `to` already owns. Preview names are
 * unique per (org, repoid, name); a preview whose name already exists under
 * `to` stays behind under `from` rather than clobbering the destination's.
 * With `dryRun` the rows are only listed, never written.
 */
export async function transferBoundary(
  exec: DbExecutor,
  opts: { orgId: string; from: string; to: string; dryRun: boolean },
): Promise<TransferredSlugs> {
  const { orgId, from, to, dryRun } = opts;

  // The old repo's live rows, via the same canonical predicate every
  // reconciler scopes with, so "a repo's live rows" is defined in one place.
  const fromNs = { orgId, repoid: from, kind: "live" } as const;
  const dashScope = previewScope(dashboards, fromNs);
  const runbookScope = previewScope(runbooks, fromNs);
  const alertScope = previewScope(alertDefinitions, fromNs);

  if (dryRun) {
    // The dry-run listing's only caller passes the pool db (the transaction
    // executor is used only for the real relabel below), so the three
    // independent reads can run concurrently.
    const [d, r, a] = await Promise.all([
      exec.select({ slug: dashboards.slug }).from(dashboards).where(dashScope),
      exec.select({ slug: runbooks.slug }).from(runbooks).where(runbookScope),
      exec
        .select({ slug: alertDefinitions.slug })
        .from(alertDefinitions)
        .where(alertScope),
    ]);
    return {
      dashboards: d.map((row) => row.slug),
      runbooks: r.map((row) => row.slug),
      alerts: a.map((row) => row.slug),
    };
  }

  const d = await exec
    .update(dashboards)
    .set({ repoid: to })
    .where(dashScope)
    .returning({ slug: dashboards.slug });
  const r = await exec
    .update(runbooks)
    .set({ repoid: to })
    .where(runbookScope)
    .returning({ slug: runbooks.slug });
  const a = await exec
    .update(alertDefinitions)
    .set({ repoid: to })
    .where(alertScope)
    .returning({ slug: alertDefinitions.slug });

  // Previews follow their repo, except where the destination already has a
  // preview of the same name (unique per (org, repoid, name)); those stay
  // behind so the destination's preview is never clobbered.
  const taken = await exec
    .select({ name: previews.name })
    .from(previews)
    .where(and(eq(previews.organizationId, orgId), eq(previews.repoid, to)));
  const takenNames = taken.map((row) => row.name);
  await exec
    .update(previews)
    .set({ repoid: to })
    .where(
      and(
        eq(previews.organizationId, orgId),
        eq(previews.repoid, from),
        ...(takenNames.length > 0
          ? [notInArray(previews.name, takenNames)]
          : []),
      ),
    );

  return {
    dashboards: d.map((row) => row.slug),
    runbooks: r.map((row) => row.slug),
    alerts: a.map((row) => row.slug),
  };
}
