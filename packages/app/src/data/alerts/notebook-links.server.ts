import { and, eq } from "drizzle-orm";
import { ApplyValidationError } from "@/data/as-code/errors";
import type { ApplyResourceEntry } from "@/data/as-code/schema";
import {
  projectFromDocument,
  slugFromDocument,
} from "@/data/dashboards/desired";
import { db } from "@/db/client";
import { notebooks } from "@/db/schema";
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

  const identities = new Set<string>();
  for (const { path, resource } of opts.notebooks) {
    identities.add(
      identityKey(
        projectFromDocument(path, resource),
        slugFromDocument(path, resource),
      ),
    );
  }

  const dbRows = await db
    .select({ project: notebooks.project, slug: notebooks.slug })
    .from(notebooks)
    .where(
      and(
        eq(notebooks.organizationId, opts.orgId),
        eq(notebooks.repoid, opts.repoid),
      ),
    );
  for (const row of dbRows) identities.add(identityKey(row.project, row.slug));

  for (const { path, ref } of links) {
    if (!identities.has(identityKey(ref.project, ref.slug))) {
      throw new ApplyValidationError(
        `${path}: linked notebook "${ref.project}/${ref.slug}" does not exist (not in this apply and not already applied)`,
      );
    }
  }
}
