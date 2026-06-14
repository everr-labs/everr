import { applyDashboardSpecs } from "@/data/dashboards/apply.server";
import { applyNotebookSpecs } from "@/data/notebooks/apply.server";
import { ApplyValidationError } from "./errors";

export interface ApplyDocument {
  path: string;
  document: unknown;
}

export interface KindResult {
  kind: string;
  created: string[];
  updated: string[];
  deleted: string[];
}

export interface ApplyResourcesResult {
  dryRun: boolean;
  results: KindResult[];
}

/** A reconciler makes the org's resources of one kind match the given docs. */
type Reconciler = (opts: {
  orgId: string;
  projects: string[];
  documents: ApplyDocument[];
  dryRun?: boolean;
}) => Promise<{ created: string[]; updated: string[]; deleted: string[] }>;

/**
 * Resource kind → reconciler. Add a new kind (e.g. "Alert") by adding one entry;
 * the CLI does not change. Every registered kind is reconciled on each apply, so
 * a kind absent from the tree is pruned within the declared projects — the tree
 * is the complete desired state across all kinds for those projects.
 */
const REGISTRY: Record<string, Reconciler> = {
  Dashboard: applyDashboardSpecs,
  Notebook: applyNotebookSpecs,
};

function documentKind(doc: ApplyDocument): string {
  const kind = (doc.document as { kind?: unknown } | null)?.kind;
  if (typeof kind !== "string" || kind.length === 0) {
    throw new ApplyValidationError(
      `${doc.path}: document is missing a string "kind"`,
    );
  }
  return kind;
}

/**
 * Apply a heterogeneous set of resource documents for the declared projects:
 * group by kind, reject unknown kinds, then reconcile EVERY registered kind
 * (groups default to empty so absent kinds prune within the declared projects).
 * Returns a per-kind summary.
 *
 * Reconcilers run sequentially and each one writes on its own, so a later kind
 * that fails validation must not be able to let an earlier kind write first. We
 * therefore reconcile in two passes: a dry-run pass that validates every kind
 * (each reconciler runs its full document validation but performs no writes),
 * then — only if all kinds validated — the real apply pass. Without this, an
 * apply carrying a single invalid Notebook would let the Dashboard reconciler
 * prune the declared projects before Notebook validation threw.
 */
export async function applyResources(opts: {
  orgId: string;
  projects: string[];
  documents: ApplyDocument[];
  dryRun?: boolean;
}): Promise<ApplyResourcesResult> {
  const { orgId, projects, documents, dryRun } = opts;

  const byKind = new Map<string, ApplyDocument[]>();
  for (const doc of documents) {
    const kind = documentKind(doc);
    // Own-property check, not `kind in REGISTRY`: `in` walks the prototype chain,
    // so inherited names like "constructor"/"toString" would pass validation but
    // never reconcile (the loop below iterates own keys), silently dropping the
    // doc while registered kinds still prune — a typo could wipe the project.
    if (!Object.hasOwn(REGISTRY, kind)) {
      throw new ApplyValidationError(`unknown kind "${kind}" in ${doc.path}`);
    }
    byKind.set(kind, [...(byKind.get(kind) ?? []), doc]);
  }

  const groupFor = (kind: string) => byKind.get(kind) ?? [];
  const summarize = (
    kind: string,
    r: { created: string[]; updated: string[]; deleted: string[] },
  ): KindResult => ({
    kind,
    created: r.created,
    updated: r.updated,
    deleted: r.deleted,
  });

  // Validation pass: every kind reconciles in dryRun mode, which runs the full
  // document validation but writes nothing. Any invalid document throws here,
  // before any kind has written. When the caller asked for a dry run, this pass
  // is also the result.
  const validated: KindResult[] = [];
  for (const [kind, reconcile] of Object.entries(REGISTRY)) {
    const r = await reconcile({
      orgId,
      projects,
      documents: groupFor(kind),
      dryRun: true,
    });
    validated.push(summarize(kind, r));
  }

  if (dryRun) return { dryRun: true, results: validated };

  // All kinds validated above; now apply for real.
  const results: KindResult[] = [];
  for (const [kind, reconcile] of Object.entries(REGISTRY)) {
    const r = await reconcile({
      orgId,
      projects,
      documents: groupFor(kind),
      dryRun: false,
    });
    results.push(summarize(kind, r));
  }

  return { dryRun: false, results };
}
