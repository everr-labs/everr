import type { Dashboard } from "./schema";

/** A dashboard as it exists in the store, scoped to its project. */
export interface ExistingDashboard {
  project: string;
  slug: string;
  folderPath: string;
  document: Dashboard;
}

/** A dashboard declared in the desired set (parsed from a file). */
export interface DesiredDashboard {
  project: string;
  slug: string;
  folderPath: string;
  document: Dashboard;
}

export interface ReconcileDiff {
  creates: DesiredDashboard[];
  updates: DesiredDashboard[];
  deletes: { project: string; slug: string }[];
}

/**
 * Compute the create/update/delete diff to make the given dashboards match the
 * desired set. Identity is keyed by (project, slug). `existing` MUST already be
 * scoped to the declared reconcile scope (which may include projects absent from
 * `desired`, e.g. the stale side of a cross-project move or an emptied project) —
 * this function prunes anything in `existing` not in `desired`, which is what
 * makes delete-by-default safe across projects and across repos.
 *
 * A dashboard is "changed" when its folderPath or its document differs.
 * Documents are compared by stable-stringify so unknown Perses fields
 * participate in the comparison and are preserved verbatim (stored as-is).
 */
export function reconcile(input: {
  existing: ExistingDashboard[];
  desired: DesiredDashboard[];
}): ReconcileDiff {
  const key = (d: { project: string; slug: string }) =>
    `${d.project} ${d.slug}`;
  const existingByKey = new Map(input.existing.map((d) => [key(d), d]));
  const desiredKeys = new Set(input.desired.map(key));

  const creates: DesiredDashboard[] = [];
  const updates: DesiredDashboard[] = [];
  for (const want of input.desired) {
    const have = existingByKey.get(key(want));
    if (!have) {
      creates.push(want);
    } else if (
      have.folderPath !== want.folderPath ||
      stableStringify(have.document) !== stableStringify(want.document)
    ) {
      updates.push(want);
    }
  }

  const deletes = input.existing
    .filter((d) => !desiredKeys.has(key(d)))
    .map((d) => ({ project: d.project, slug: d.slug }));

  return { creates, updates, deletes };
}

/** Deterministic JSON with object keys sorted recursively. */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}
