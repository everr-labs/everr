/** A resource as it exists in the store, scoped to its project. */
export interface ExistingResource {
  project: string;
  slug: string;
  folderPath: string;
  document: unknown;
}

/** A resource declared in the desired set (parsed from a file). */
export interface DesiredResource {
  project: string;
  slug: string;
  folderPath: string;
  document: unknown;
}

export interface ReconcileDiff {
  creates: DesiredResource[];
  updates: DesiredResource[];
  deletes: { project: string; slug: string }[];
}

/**
 * The global identity of a resource within an org: (project, slug), NUL-joined.
 * NUL can't appear in a project or slug, so the key is unambiguous even if a
 * segment ever contained the separator (a space would let "a b"+"c" collide
 * with "a"+"b c"). This is the single notion the whole as-code layer keys on —
 * reconcile diffing, ownership conflicts, and the read-side overlay.
 */
export const identityKey = (r: { project: string; slug: string }): string =>
  `${r.project}\u0000${r.slug}`;

/**
 * Compute the create/update/delete diff to make the given resources match the
 * desired set. Identity is keyed by (project, slug). `existing` MUST already be
 * scoped to the declared reconcile scope (which may include projects absent from
 * `desired`, e.g. the stale side of a cross-project move or an emptied project) —
 * this function prunes anything in `existing` not in `desired`, which is what
 * makes delete-by-default safe across projects and across repos.
 *
 * A resource is "changed" when its folderPath or its document differs.
 * Documents are compared by stable-stringify so unknown fields participate in
 * the comparison and are preserved verbatim (stored as-is).
 */
export function reconcile(input: {
  existing: ExistingResource[];
  desired: DesiredResource[];
}): ReconcileDiff {
  const existingByKey = new Map(input.existing.map((d) => [identityKey(d), d]));
  const desiredKeys = new Set(input.desired.map(identityKey));

  const creates: DesiredResource[] = [];
  const updates: DesiredResource[] = [];
  for (const want of input.desired) {
    const have = existingByKey.get(identityKey(want));
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
    .filter((d) => !desiredKeys.has(identityKey(d)))
    .map((d) => ({ project: d.project, slug: d.slug }));

  return { creates, updates, deletes };
}

/** Deterministic JSON with object keys sorted recursively. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  // Explicit `!== null`: `typeof null === "object"`, so without this guard a
  // null field would hit the object branch and `Object.keys(null)` would throw.
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}
