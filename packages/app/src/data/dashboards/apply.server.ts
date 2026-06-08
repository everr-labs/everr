import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { dashboards } from "@/db/schema";
import { buildDesiredSet } from "./desired";
import { reconcile } from "./reconcile";
import type { DashboardSpec } from "./schema";

export interface ApplyDashboardsResult {
  created: string[];
  updated: string[];
  deleted: string[];
  dryRun: boolean;
}

/**
 * Source-scoped declarative reconcile core, shared by the apply route. Loads
 * ONLY the given source's dashboards, diffs against the desired documents, and
 * (unless dryRun) applies creates/updates/deletes in a single transaction.
 *
 * Lives in a `.server.ts` module — not `server.ts` — because it is a plain
 * exported function that touches `db` (the pg pool). `server.ts` is reachable
 * from the client via `options.ts`, and a plain db-using export there would
 * drag `pg` into the browser bundle ("Buffer is not defined").
 */
export async function applyDashboardSpecs(opts: {
  orgId: string;
  source: string;
  documents: { path: string; document: unknown }[];
  dryRun?: boolean;
}): Promise<ApplyDashboardsResult> {
  const { orgId, source, documents, dryRun } = opts;

  const desired = buildDesiredSet(documents);

  const existing = await db
    .select({
      slug: dashboards.slug,
      folderPath: dashboards.folderPath,
      spec: dashboards.spec,
    })
    .from(dashboards)
    .where(
      and(eq(dashboards.organizationId, orgId), eq(dashboards.source, source)),
    );

  const diff = reconcile({ existing, desired });

  const summary: ApplyDashboardsResult = {
    created: diff.creates.map((d) => d.slug),
    updated: diff.updates.map((d) => d.slug),
    deleted: diff.deletes,
    dryRun: dryRun ?? false,
  };

  if (dryRun) return summary;

  await db.transaction(async (tx) => {
    for (const d of diff.creates) {
      await tx.insert(dashboards).values({
        organizationId: orgId,
        source,
        slug: d.slug,
        folderPath: d.folderPath,
        spec: d.spec as DashboardSpec,
      });
    }
    for (const d of diff.updates) {
      await tx
        .update(dashboards)
        .set({
          spec: d.spec as DashboardSpec,
          folderPath: d.folderPath,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(dashboards.organizationId, orgId),
            eq(dashboards.source, source),
            eq(dashboards.slug, d.slug),
          ),
        );
    }
    for (const slug of diff.deletes) {
      await tx
        .delete(dashboards)
        .where(
          and(
            eq(dashboards.organizationId, orgId),
            eq(dashboards.source, source),
            eq(dashboards.slug, slug),
          ),
        );
    }
  });

  return summary;
}
