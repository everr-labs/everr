import { and, eq, or } from "drizzle-orm";
import { ApplyValidationError } from "@/data/as-code/errors";
import type { ApplyResourceEntry } from "@/data/as-code/schema";
import { projectFromDocument, slugFromDocument } from "@/data/dashboards/desired";
import { type Namespace, previewScope } from "@/data/previews/scope";
import { db } from "@/db/client";
import { runbooks } from "@/db/schema";
import { AlertRuleYamlSchema, identityKey, parseRunbookRef } from "./schema";

/**
 * Validate that every alert's `spec.runbook` resolves to a runbook that
 * either ships in this same apply batch or already exists in the DB for the
 * repo. Cross-kind, so it runs from the apply orchestration rather than the
 * single-kind alert reconciler. Runbook identity is `(project, slug)`, scoped
 * to the namespace: (org, repoid) for live, or the preview registry id.
 */
export async function validateAlertRunbookLinks(opts: {
  namespace: Namespace;
  alerts: ApplyResourceEntry[];
  runbooks: ApplyResourceEntry[];
}): Promise<void> {
  // Resolve the runbook ref for each alert that has one. Skip schema-invalid
  // alerts — the alert reconciler's own validation reports those.
  const links = opts.alerts.flatMap(({ path, resource }) => {
    const parsed = AlertRuleYamlSchema.safeParse(resource);
    if (!parsed.success || !parsed.data.spec.runbook) return [];
    const project = parsed.data.metadata.project ?? "default";
    return [{ path, ref: parseRunbookRef(parsed.data.spec.runbook, project) }];
  });
  if (links.length === 0) return;

  // Identities satisfied by a runbook shipping in this same apply batch.
  const identities = new Set<string>();
  for (const { path, resource } of opts.runbooks) {
    identities.add(
      identityKey(projectFromDocument(path, resource), slugFromDocument(path, resource)),
    );
  }

  // Only the refs the batch doesn't already cover need a DB lookup. Dedupe so
  // the query checks each distinct (project, slug) once — bounded by the number
  // of linked runbooks, not the repo's runbook count.
  const missing = new Map<string, { project: string; slug: string }>();
  for (const { ref } of links) {
    const key = identityKey(ref.project, ref.slug);
    if (!identities.has(key)) missing.set(key, ref);
  }

  // Runbooks already in the DB for this namespace: (org, repoid) for live, the
  // registry id for a preview. A preview with no registry row yet matches
  // nothing, so only the batch counts.
  if (missing.size > 0) {
    const refs = [...missing.values()];
    const dbRows = await db
      .select({ project: runbooks.project, slug: runbooks.slug })
      .from(runbooks)
      .where(
        and(
          previewScope(runbooks, opts.namespace),
          or(
            ...refs.map((ref) =>
              and(eq(runbooks.project, ref.project), eq(runbooks.slug, ref.slug)),
            ),
          ),
        ),
      );
    for (const row of dbRows) identities.add(identityKey(row.project, row.slug));
  }

  for (const { path, ref } of links) {
    if (!identities.has(identityKey(ref.project, ref.slug))) {
      throw new ApplyValidationError(
        `${path}: linked runbook "${ref.project}/${ref.slug}" does not exist (not in this apply and not already applied)`,
      );
    }
  }
}
