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

  const results: KindResult[] = [];
  for (const [kind, reconcile] of Object.entries(REGISTRY)) {
    const group = byKind.get(kind) ?? [];
    const r = await reconcile({ orgId, projects, documents: group, dryRun });
    results.push({
      kind,
      created: r.created,
      updated: r.updated,
      deleted: r.deleted,
    });
  }

  return { dryRun: dryRun ?? false, results };
}
