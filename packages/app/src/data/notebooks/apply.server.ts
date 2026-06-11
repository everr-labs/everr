import { and, eq, inArray } from "drizzle-orm";
import { ApplyValidationError } from "@/data/as-code/errors";
import { reconcile } from "@/data/as-code/reconcile";
import { db } from "@/db/client";
import { notebooks } from "@/db/schema";
import { buildDesiredNotebookSet } from "./desired";
import type { Notebook } from "./schema";

export interface ApplyNotebooksResult {
  created: string[];
  updated: string[];
  deleted: string[];
  dryRun: boolean;
}

/**
 * Declarative reconcile core for notebooks; same contract as dashboards: the
 * declared `projects` are the authoritative scope, every desired notebook must
 * target a declared project, anything existing-but-not-desired within scope is
 * pruned, and writes happen in one transaction.
 *
 * Lives in `.server.ts` (not `server.ts`) because it is a plain db-using
 * export; `server.ts` is reachable from the client and would drag `pg` into
 * the bundle.
 */
export async function applyNotebookSpecs(opts: {
  orgId: string;
  projects: string[];
  documents: { path: string; document: unknown }[];
  dryRun?: boolean;
}): Promise<ApplyNotebooksResult> {
  const { orgId, projects, documents, dryRun } = opts;

  const desired = buildDesiredNotebookSet(documents);

  const scope = [...new Set(projects)];
  const scopeSet = new Set(scope);

  for (const d of desired) {
    if (!scopeSet.has(d.project)) {
      throw new ApplyValidationError(
        `notebook "${d.slug}" targets project "${d.project}", which is not declared in everr.yaml (add it to projects)`,
      );
    }
  }

  const existing =
    scope.length === 0
      ? []
      : await db
          .select({
            project: notebooks.project,
            slug: notebooks.slug,
            folderPath: notebooks.folderPath,
            document: notebooks.document,
          })
          .from(notebooks)
          .where(
            and(
              eq(notebooks.organizationId, orgId),
              inArray(notebooks.project, scope),
            ),
          );

  const diff = reconcile({ existing, desired });

  const summary: ApplyNotebooksResult = {
    created: diff.creates.map((d) => d.slug),
    updated: diff.updates.map((d) => d.slug),
    deleted: diff.deletes.map((d) => d.slug),
    dryRun: dryRun ?? false,
  };

  if (dryRun) return summary;

  await db.transaction(async (tx) => {
    for (const d of diff.creates) {
      await tx.insert(notebooks).values({
        organizationId: orgId,
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
            eq(notebooks.project, d.project),
            eq(notebooks.slug, d.slug),
          ),
        );
    }
  });

  return summary;
}
