import { and, eq, or } from "drizzle-orm";
import { ApplyValidationError } from "@/data/as-code/errors";
import type { ApplyResourceEntry } from "@/data/as-code/schema";
import {
  projectFromDocument,
  slugFromDocument,
} from "@/data/dashboards/desired";
import { db } from "@/db/client";
import { runbooks } from "@/db/schema";
import { AlertRuleYamlSchema, identityKey, parseNotebookRef } from "./schema";

/**
 * Validate that every alert's `spec.notebook` resolves to a notebook that
 * either ships in this same apply batch or already exists in the DB for the
 * repo. Cross-kind, so it runs from the apply orchestration rather than the
 * single-kind alert reconciler. Notebook identity is `(project, slug)`, scoped
 * to (org, repoid).
 */
export async function validateAlertNotebookLinks(opts: {
  orgId: string;
  repoid: string;
  alerts: ApplyResourceEntry[];
  notebooks: ApplyResourceEntry[];
}): Promise<void> {
  // Resolve the notebook ref for each alert that has one. Skip schema-invalid
  // alerts — the alert reconciler's own validation reports those.
  const links = opts.alerts.flatMap(({ path, resource }) => {
    const parsed = AlertRuleYamlSchema.safeParse(resource);
    if (!parsed.success || !parsed.data.spec.notebook) return [];
    const project = parsed.data.metadata.project ?? "default";
    return [
      { path, ref: parseNotebookRef(parsed.data.spec.notebook, project) },
    ];
  });
  if (links.length === 0) return;

  // Identities satisfied by a notebook shipping in this same apply batch.
  const identities = new Set<string>();
  for (const { path, resource } of opts.notebooks) {
    identities.add(
      identityKey(
        projectFromDocument(path, resource),
        slugFromDocument(path, resource),
      ),
    );
  }

  // Only the refs the batch doesn't already cover need a DB lookup. Dedupe so
  // the query checks each distinct (project, slug) once — bounded by the number
  // of linked notebooks, not the repo's notebook count.
  const missing = new Map<string, { project: string; slug: string }>();
  for (const { ref } of links) {
    const key = identityKey(ref.project, ref.slug);
    if (!identities.has(key)) missing.set(key, ref);
  }

  if (missing.size > 0) {
    const refs = [...missing.values()];
    const dbRows = await db
      .select({ project: runbooks.project, slug: runbooks.slug })
      .from(runbooks)
      .where(
        and(
          eq(runbooks.organizationId, opts.orgId),
          eq(runbooks.repoid, opts.repoid),
          or(
            ...refs.map((ref) =>
              and(
                eq(runbooks.project, ref.project),
                eq(runbooks.slug, ref.slug),
              ),
            ),
          ),
        ),
      );
    for (const row of dbRows)
      identities.add(identityKey(row.project, row.slug));
  }

  for (const { path, ref } of links) {
    if (!identities.has(identityKey(ref.project, ref.slug))) {
      throw new ApplyValidationError(
        `${path}: linked notebook "${ref.project}/${ref.slug}" does not exist (not in this apply and not already applied)`,
      );
    }
  }
}
