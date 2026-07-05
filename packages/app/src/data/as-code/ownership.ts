import { identityKey } from "./reconcile";

/** A create that collides with a live resource owned by a different repo. */
export interface OwnershipConflict {
  project: string;
  slug: string;
  owner: string;
}

/** A live row (found by `foreignLiveScope`) that owns a colliding identity. */
export interface ForeignOwner {
  project: string;
  slug: string;
  /** The owning repoid (`repoid` is nullable in the schema; null → ""). */
  owner: string | null;
}

export interface OwnershipPartition<T> {
  /** Creates whose identity is free — safe to insert. */
  freshCreates: T[];
  /** Creates whose identity another repo owns — transferred when adopting. */
  takenCreates: T[];
  /** Slugs taken over from another repo (only when adopting; else empty). */
  adopted: string[];
  /** Conflicts to fail-fast on (only when NOT adopting; else empty). */
  conflicts: OwnershipConflict[];
}

/**
 * Split desired creates by whether another repo already owns their (project,
 * slug) identity. `foreignRows` are the colliding live rows found by
 * `foreignLiveScope`. When adopting, the taken creates are reported as `adopted`
 * and the caller transfers ownership; otherwise they are `conflicts` and the
 * registry fails fast before any write. This is the shared ownership policy the
 * three reconcilers apply on top of their own (kind-specific) probe and writes.
 */
export function partitionByOwnership<T extends { project: string; slug: string }>(
  creates: readonly T[],
  foreignRows: readonly ForeignOwner[],
  adopt: boolean | undefined,
): OwnershipPartition<T> {
  const ownerFor = new Map(foreignRows.map((r) => [identityKey(r), r.owner ?? ""]));
  const freshCreates: T[] = [];
  const takenCreates: T[] = [];
  for (const create of creates) {
    (ownerFor.has(identityKey(create)) ? takenCreates : freshCreates).push(create);
  }
  return {
    freshCreates,
    takenCreates,
    adopted: adopt ? takenCreates.map((c) => c.slug) : [],
    conflicts: adopt
      ? []
      : takenCreates.map((c) => ({
          project: c.project,
          slug: c.slug,
          owner: ownerFor.get(identityKey(c)) ?? "",
        })),
  };
}
