import { and, eq, or } from "drizzle-orm";
import {
  parseRunbookRef,
  refIdentityKey,
} from "@/data/alerting/resource/runbook-ref";
import { listAllRules } from "@/data/alerting/rules/repository";
import { fromAlertingRule } from "@/data/alerting/rules/resource/mapping";
import { AlertRuleYamlSchema } from "@/data/alerting/rules/resource/schema";
import {
  projectFromDocument,
  slugFromDocument,
} from "@/data/dashboards/desired";
import {
  foreignLiveScope,
  type Namespace,
  previewScope,
} from "@/data/previews/scope";
import { db } from "@/db/client";
import { runbooks } from "@/db/schema";
import { ApplyValidationError } from "./errors";
import type { ApplyResourceEntry } from "./schema";

/** A `spec.runbook` reference resolved to (project, slug), tagged with its
 * document path for error messages. */
interface TaggedRef {
  path: string;
  ref: { project: string; slug: string };
}

// The alert reconciler reports invalid documents.
function alertRunbookRefs(alerts: ApplyResourceEntry[]): TaggedRef[] {
  return alerts.flatMap(({ path, resource }) => {
    const parsed = AlertRuleYamlSchema.safeParse(resource);
    if (!parsed.success || !parsed.data.spec.runbook) return [];
    const project = parsed.data.metadata.project ?? "default";
    return [{ path, ref: parseRunbookRef(parsed.data.spec.runbook, project) }];
  });
}

/**
 * Verify that each alert references an available runbook.
 * The runbook can be in this apply batch or in another repository.
 * A runbook from the same repository must be in the batch because apply can
 * delete stored resources that are absent from the batch.
 * A preview can also use runbooks registered in that preview.
 */
export async function validateRunbookLinks(opts: {
  namespace: Namespace;
  alerts: ApplyResourceEntry[];
  runbooks: ApplyResourceEntry[];
}): Promise<void> {
  const links = alertRunbookRefs(opts.alerts);
  if (links.length === 0) return;

  // Identities satisfied by a runbook shipping in this same apply batch.
  const identities = new Set<string>();
  for (const { path, resource } of opts.runbooks) {
    identities.add(
      refIdentityKey(
        projectFromDocument(path, resource),
        slugFromDocument(path, resource),
      ),
    );
  }

  // Query each unresolved runbook identity once.
  const missing = new Map<string, { project: string; slug: string }>();
  for (const { ref } of links) {
    const key = refIdentityKey(ref.project, ref.slug);
    if (!identities.has(key)) missing.set(key, ref);
  }

  if (missing.size > 0) {
    const refs = [...missing.values()];
    // A live apply accepts runbooks from another repository. It rejects stored
    // runbooks from this repository because reconciliation can delete them.
    // A preview also accepts runbooks registered in that preview.
    const foreignLive = foreignLiveScope(
      runbooks,
      {
        kind: "live",
        orgId: opts.namespace.orgId,
        repoid: opts.namespace.repoid,
      },
      refs,
    );
    const scope =
      opts.namespace.kind === "live"
        ? foreignLive
        : or(
            and(
              previewScope(runbooks, opts.namespace),
              or(
                ...refs.map((ref) =>
                  and(
                    eq(runbooks.project, ref.project),
                    eq(runbooks.slug, ref.slug),
                  ),
                ),
              ),
            ),
            foreignLive,
          );
    const dbRows = await db
      .select({ project: runbooks.project, slug: runbooks.slug })
      .from(runbooks)
      .where(scope);
    for (const row of dbRows)
      identities.add(refIdentityKey(row.project, row.slug));
  }

  for (const { path, ref } of links) {
    if (!identities.has(refIdentityKey(ref.project, ref.slug))) {
      throw new ApplyValidationError(
        `${path}: linked runbook "${ref.project}/${ref.slug}" does not exist (not in this apply and not owned by another repo)`,
      );
    }
  }
}

// Warn when a live apply deletes a runbook used by another repository.
// Previews do not delete live runbooks.
export async function collectOrphanWarnings(opts: {
  namespace: Namespace;
  runbooks: ApplyResourceEntry[];
}): Promise<string[]> {
  if (opts.namespace.kind !== "live") return [];

  const batch = new Set(
    opts.runbooks.map(({ path, resource }) =>
      refIdentityKey(
        projectFromDocument(path, resource),
        slugFromDocument(path, resource),
      ),
    ),
  );
  const mine = await db
    .select({ project: runbooks.project, slug: runbooks.slug })
    .from(runbooks)
    .where(previewScope(runbooks, opts.namespace));
  const deleted = mine.filter(
    (r) => !batch.has(refIdentityKey(r.project, r.slug)),
  );
  if (deleted.length === 0) return [];
  const deletedKeys = new Set(
    deleted.map((r) => refIdentityKey(r.project, r.slug)),
  );

  const { orgId, repoid } = opts.namespace;
  const rules = await listAllRules(orgId, { previewId: null });

  const warnings: string[] = [];
  const check = (
    kind: "alert",
    name: string,
    owner: string | null,
    ref: { project: string; slug: string } | null,
  ) => {
    if (!owner || owner === repoid || !ref) return;
    const key = refIdentityKey(ref.project, ref.slug);
    if (!deletedKeys.has(key)) return;
    warnings.push(
      `deleting runbook "${ref.project}/${ref.slug}" orphans the link from ${kind} "${name}" (owned by ${owner})`,
    );
  };

  for (const r of rules) {
    const v = fromAlertingRule(r);
    check(
      "alert",
      r.name,
      v.repoid || null,
      v.runbookSlug
        ? { project: v.runbookProject ?? "default", slug: v.runbookSlug }
        : null,
    );
  }
  return warnings;
}
