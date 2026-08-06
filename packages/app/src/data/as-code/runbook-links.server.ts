import { and, eq, or } from "drizzle-orm";
import * as alerting from "@/data/alerting/repository";
import { fromAlertingRule } from "@/data/alerts/mapping";
import {
  AlertRuleYamlSchema,
  parseRunbookRef,
  refIdentityKey,
} from "@/data/alerts/schema";
import {
  projectFromDocument,
  slugFromDocument,
} from "@/data/dashboards/desired";
import {
  foreignLiveScope,
  type Namespace,
  previewScope,
} from "@/data/previews/scope";
import { fromAlertingSlo } from "@/data/slos/mapping";
import { SloYamlSchema } from "@/data/slos/schema";
import { db } from "@/db/client";
import { runbooks } from "@/db/schema";
import { ApplyValidationError } from "./errors";
import type { ApplyResourceEntry } from "./schema";

/** A `spec.runbook` reference resolved to (project, slug), tagged with the
 * document path it came from (alert or SLO) for error messages. */
interface TaggedRef {
  path: string;
  ref: { project: string; slug: string };
}

// Resolve every AlertRule's `spec.runbook` ref. Skips schema-invalid
// documents — the alert reconciler's own validation reports those.
function alertRunbookRefs(alerts: ApplyResourceEntry[]): TaggedRef[] {
  return alerts.flatMap(({ path, resource }) => {
    const parsed = AlertRuleYamlSchema.safeParse(resource);
    if (!parsed.success || !parsed.data.spec.runbook) return [];
    const project = parsed.data.metadata.project ?? "default";
    return [{ path, ref: parseRunbookRef(parsed.data.spec.runbook, project) }];
  });
}

// Resolve every SLO's `spec.runbook` ref, same grammar as the AlertRule one
// (shared parseRunbookRef). Skips schema-invalid documents — the SLO
// reconciler's own validation reports those.
function sloRunbookRefs(slos: ApplyResourceEntry[]): TaggedRef[] {
  return slos.flatMap(({ path, resource }) => {
    const parsed = SloYamlSchema.safeParse(resource);
    if (!parsed.success || !parsed.data.spec.runbook) return [];
    const project = parsed.data.metadata.project ?? "default";
    return [{ path, ref: parseRunbookRef(parsed.data.spec.runbook, project) }];
  });
}

/**
 * Validate that every alert's and SLO's `spec.runbook` resolves to a runbook
 * that either ships in this same apply batch, or is already owned by another
 * repo's live runbook row. Cross-kind, so it runs from the apply
 * orchestration rather than a single-kind reconciler.
 *
 * A same-repo live DB row does NOT satisfy a ref: this apply's Runbook
 * reconciler prunes exactly the rows in this repo that aren't in the batch,
 * so such a row is about to disappear and letting it resolve the ref would
 * be a lie. Runbook identity is `(project, slug)`. A preview namespace
 * additionally accepts rows already registered under that preview, and the
 * same foreign live rows a live apply accepts, so a config valid live is
 * valid as a preview.
 */
export async function validateRunbookLinks(opts: {
  namespace: Namespace;
  alerts: ApplyResourceEntry[];
  slos: ApplyResourceEntry[];
  runbooks: ApplyResourceEntry[];
}): Promise<void> {
  const links = [
    ...alertRunbookRefs(opts.alerts),
    ...sloRunbookRefs(opts.slos),
  ];
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

  // Only the refs the batch doesn't already cover need a DB lookup. Dedupe so
  // the query checks each distinct (project, slug) once — bounded by the
  // number of linked runbooks, not the repo's runbook count.
  const missing = new Map<string, { project: string; slug: string }>();
  for (const { ref } of links) {
    const key = refIdentityKey(ref.project, ref.slug);
    if (!identities.has(key)) missing.set(key, ref);
  }

  if (missing.size > 0) {
    const refs = [...missing.values()];
    // Live: only rows owned by another repo satisfy a ref not in this batch
    // — this repo's own rows absent from the batch are exactly what this
    // apply is about to prune. Preview: the preview's own registry-scoped
    // rows (or the batch) satisfy a ref, and so do OTHER repos' live rows —
    // a preview simulates this repo's eventual live apply, which foreign
    // live runbooks survive, so a config that passes live must pass as a
    // preview too. Own-repo live rows stay excluded for the same prune
    // reason as the live branch. foreignLiveScope is live-only by contract
    // (previews skip ownership checks), so probe it with the namespace's
    // live-shaped identity.
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

/**
 * Reverse check for a live apply: this repo's live runbook rows that are
 * about to be pruned (present in the DB, absent from this batch), cross-
 * referenced against every OTHER repo's live alerting engine rules and SLOs whose
 * `everr.runbook` link resolves to one of them. Each hit is a warning, not a
 * failure — the apply proceeds, but the caller (a linked resource in another
 * repo) is about to lose its runbook. Preview namespaces never prune a live
 * runbook, so they always return `[]`.
 */
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
  const [rules, slos] = await Promise.all([
    alerting.listAllRules(orgId, { previewId: null }),
    alerting.listSlos(orgId, { previewId: null }),
  ]);

  const warnings: string[] = [];
  const check = (
    kind: "alert" | "slo",
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
  for (const s of slos) {
    const v = fromAlertingSlo(s);
    check(
      "slo",
      s.name,
      v.repoid || null,
      v.runbookSlug
        ? { project: v.runbookProject ?? "default", slug: v.runbookSlug }
        : null,
    );
  }
  return warnings;
}
