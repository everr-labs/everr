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
  deletes: string[];
}

/**
 * Compute the create/update/delete diff to make a single source's dashboards
 * match the desired set. `existing` MUST already be scoped to the applying
 * source — this function never reasons about other sources, which is what makes
 * delete-by-default safe across multiple repos.
 *
 * A dashboard is "changed" when its folderPath or its document differs.
 * Documents are compared by stable-stringify so unknown Perses fields
 * participate in the comparison and are preserved verbatim (stored as-is).
 */
export function reconcile(input: {
  existing: ExistingDashboard[];
  desired: DesiredDashboard[];
}): ReconcileDiff {
  const existingBySlug = new Map(input.existing.map((d) => [d.slug, d]));
  const desiredSlugs = new Set(input.desired.map((d) => d.slug));

  const creates: DesiredDashboard[] = [];
  const updates: DesiredDashboard[] = [];
  for (const want of input.desired) {
    const have = existingBySlug.get(want.slug);
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
    .filter((d) => !desiredSlugs.has(d.slug))
    .map((d) => d.slug);

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
