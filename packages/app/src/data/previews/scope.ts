import {
  and,
  eq,
  inArray,
  isNull,
  ne,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { previews } from "@/db/schema";

/** The columns every preview-scoped resource table shares. */
interface ScopedTable {
  organizationId: PgColumn;
  repoid: PgColumn;
  previewId: PgColumn;
}

/** A resource table addressable by its global identity (org, project, slug). */
interface IdentifiedTable extends ScopedTable {
  project: PgColumn;
  slug: PgColumn;
}

/**
 * The apply target: the live state of a repo, or a preview. Always carries the
 * (org, repoid) it applies to; a preview also carries its registry id (null
 * while a first apply is still being dry-run — the preview row doesn't exist
 * yet). Replaces the old `preview === ""` string sentinel.
 */
export type Namespace = {
  readonly orgId: string;
  readonly repoid: string;
} & (
  | {
      readonly kind: "live";
      /** A repoid whose whole boundary this apply transfers to `repoid`
       * (`--transfer-from`). Scopes treat its rows as already owned so a dry
       * run diffs against the post-transfer world; the real pass relabels the
       * rows first, after which this matches nothing. */
      readonly absorbs?: string;
    }
  | { readonly kind: "preview"; readonly id: string | null }
);

/** The repoids a live namespace owns: its own plus a transfer source, if any. */
function ownedRepoids(ns: Namespace & { kind: "live" }): string[] {
  return ns.absorbs ? [ns.repoid, ns.absorbs] : [ns.repoid];
}

/**
 * WHERE predicate selecting one namespace's rows in a resource table: live rows
 * by (org, repoid) with a null preview_id, preview rows by their registry id. A
 * preview with no registry row yet (dry run of a first apply) matches nothing.
 */
export function previewScope(table: ScopedTable, ns: Namespace): SQL {
  if (ns.kind === "live")
    // `and` is typed `SQL | undefined` (undefined only with zero conditions —
    // impossible here). The `?? sql`false`` keeps a non-undefined return so a
    // caller can never get an unfiltered `.where(undefined)`; it never fires.
    return (
      and(
        eq(table.organizationId, ns.orgId),
        inArray(table.repoid, ownedRepoids(ns)),
        isNull(table.previewId),
      ) ?? sql`false`
    );
  if (ns.id === null) return sql`false`;
  return eq(table.previewId, ns.id);
}

/**
 * The (repoid, preview_id) a create must set for this namespace — exactly one is
 * non-null (the schema's CHECK): live rows carry the repoid, preview rows the id.
 */
export function previewOwner(ns: Namespace): {
  repoid: string | null;
  previewId: string | null;
} {
  return ns.kind === "live"
    ? { repoid: ns.repoid, previewId: null }
    : { repoid: null, previewId: ns.id };
}

// Read-side overlay: a review view returns a repo's live rows plus one preview's
// rows and diffs them (see `overlayPreview`). Where `previewScope`/`previewOwner`
// target a single namespace, these select and describe that live+preview union.
// Each assumes the query joined `previews` via `previewJoin`.

/** ON condition joining a resource table to its registry parent. */
export function previewJoin(table: ScopedTable): SQL {
  return eq(table.previewId, previews.id);
}

/**
 * A row's effective repoid: the row's own for live rows, the joined registry
 * row's for preview rows (which keep repoid only on the parent).
 */
export function effectiveRepoid(table: ScopedTable): SQL<string> {
  return sql<string>`coalesce(${table.repoid}, ${previews.repoid})`;
}

/** WHERE predicate for the overlay read: live rows (null preview_id) plus this preview's. */
export function liveOrPreview(table: ScopedTable, preview: string): SQL {
  // `or` is typed `SQL | undefined` (undefined only with zero conditions); the
  // `?? sql`false`` keeps a non-undefined return and never fires.
  return or(isNull(table.previewId), eq(previews.name, preview)) ?? sql`false`;
}

/**
 * Live rows in this namespace's org owned by a *different* repo that collide with
 * one of the given (project, slug) identities. A live apply that would create one
 * of these is a cross-repo ownership conflict — fail-fast, or transfer with
 * `--adopt`. Non-live namespaces and empty identity sets match nothing: a preview
 * is keyed by its own parent and never collides with a live address.
 */
export function foreignLiveScope(
  table: IdentifiedTable,
  ns: Namespace,
  identities: readonly { project: string; slug: string }[],
): SQL {
  if (ns.kind !== "live" || identities.length === 0) return sql`false`;
  const matchesAnyIdentity =
    or(
      ...identities.map((id) =>
        and(eq(table.project, id.project), eq(table.slug, id.slug)),
      ),
    ) ?? sql`false`;
  const owned = ownedRepoids(ns);
  return (
    and(
      eq(table.organizationId, ns.orgId),
      isNull(table.previewId),
      owned.length === 1
        ? ne(table.repoid, ns.repoid)
        : notInArray(table.repoid, owned),
      matchesAnyIdentity,
    ) ?? sql`false`
  );
}
