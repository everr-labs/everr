import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { alertDefinitions } from "@/db/schema/alerts";
import { dashboards, runbooks } from "@/db/schema/app";

export const RESOURCE_KINDS = ["dashboard", "runbook", "alert"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export function isResourceKind(value: string): value is ResourceKind {
  return (RESOURCE_KINDS as readonly string[]).includes(value);
}

/** 400 response for a `kind` path/query segment that is not a ResourceKind. */
export function unknownKindResponse(kind: string): Response {
  return Response.json(
    {
      error: `unknown kind "${kind}"; expected one of ${RESOURCE_KINDS.join(", ")}`,
    },
    { status: 400 },
  );
}

/** 404 response for a resource that does not exist. */
export function notFoundResponse(
  kind: string,
  project: string,
  slug: string,
): Response {
  return Response.json(
    { error: `resource not found: ${kind}/${project}/${slug}` },
    { status: 404 },
  );
}

/** The Drizzle table backing each kind. */
const TABLE = {
  dashboard: dashboards,
  runbook: runbooks,
  alert: alertDefinitions,
} as const;

export interface ResourceSummary {
  kind: ResourceKind;
  project: string;
  slug: string;
  /** "" for UI-created resources. */
  repoid: string;
  updatedAt: string;
}

export interface ListFilters {
  kind?: ResourceKind;
  /** Exact owner match; "" selects UI-created. */
  repoid?: string;
}

// Drizzle infers a distinct row/table type per pgTable, so a value typed as
// `PgTable` can't be passed straight into `.select().from()` without the
// compiler losing track of column identity. The TABLE map's values are
// structurally compatible (same column shapes) but TS won't unify the union;
// a single localized cast at the query boundary keeps behavior identical while
// satisfying the compiler.
type LiveTable = typeof dashboards;

/**
 * Conditions scoping a query to a live row of `kind`: the caller's org, not a
 * preview row, and — for alerts only — not soft-deleted. `alertDefinitions`
 * carries a legacy `deletedAt` marker that the rest of the codebase always
 * excludes when reading "live" alerts (see data/alerts/server.ts); the other
 * two kinds have no such column.
 */
function liveScope(kind: ResourceKind, table: LiveTable, orgId: string) {
  const conds = [eq(table.organizationId, orgId), isNull(table.previewId)];
  if (kind === "alert") conds.push(isNull(alertDefinitions.deletedAt));
  return conds;
}

/** The full `(org, live, project, slug)` identity match for one live row. */
function scopedRow(
  kind: ResourceKind,
  table: LiveTable,
  orgId: string,
  project: string,
  slug: string,
) {
  return and(
    ...liveScope(kind, table, orgId),
    eq(table.project, project),
    eq(table.slug, slug),
  );
}

async function listOneKind(
  orgId: string,
  kind: ResourceKind,
  repoid: string | undefined,
): Promise<ResourceSummary[]> {
  const table = TABLE[kind] as LiveTable;
  const conds = liveScope(kind, table, orgId);
  if (repoid !== undefined) conds.push(eq(table.repoid, repoid));
  const rows = await db
    .select({
      project: table.project,
      slug: table.slug,
      repoid: table.repoid,
      updatedAt: table.updatedAt,
    })
    .from(table)
    .where(and(...conds));
  return rows.map((r) => ({
    kind,
    project: r.project,
    slug: r.slug,
    repoid: r.repoid ?? "",
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function listResources(
  orgId: string,
  filters: ListFilters,
): Promise<ResourceSummary[]> {
  const kinds = filters.kind ? [filters.kind] : [...RESOURCE_KINDS];
  const perKind = await Promise.all(
    kinds.map((k) => listOneKind(orgId, k, filters.repoid)),
  );
  return perKind.flat();
}

/** The stored `document` JSON, or null when the resource does not exist. */
export async function getResource(
  orgId: string,
  kind: ResourceKind,
  project: string,
  slug: string,
): Promise<unknown | null> {
  const table = TABLE[kind] as LiveTable;
  const [row] = await db
    .select({ document: table.document })
    .from(table)
    .where(scopedRow(kind, table, orgId, project, slug))
    .limit(1);
  return row?.document ?? null;
}

/** True when a row was deleted, false when none matched. */
export async function deleteResource(
  orgId: string,
  kind: ResourceKind,
  project: string,
  slug: string,
): Promise<boolean> {
  const table = TABLE[kind] as LiveTable;
  const deleted = await db
    .delete(table)
    .where(scopedRow(kind, table, orgId, project, slug))
    .returning({ slug: table.slug });
  return deleted.length > 0;
}

export interface AdoptResult {
  found: boolean;
  alreadyOwned: boolean;
  repoid: string;
}

/**
 * Reassign the live resource's `repoid` to `destRepoid`. Targeted single-row
 * flip; never touches any other resource. Returns found=false when no row
 * matches, alreadyOwned=true when it was already owned by destRepoid.
 */
export async function adoptResource(
  orgId: string,
  kind: ResourceKind,
  project: string,
  slug: string,
  destRepoid: string,
): Promise<AdoptResult> {
  const table = TABLE[kind] as LiveTable;
  const where = scopedRow(kind, table, orgId, project, slug);
  const [existing] = await db
    .select({ repoid: table.repoid })
    .from(table)
    .where(where)
    .limit(1);
  if (!existing) return { found: false, alreadyOwned: false, repoid: "" };
  if ((existing.repoid ?? "") === destRepoid) {
    return { found: true, alreadyOwned: true, repoid: destRepoid };
  }
  await db.update(table).set({ repoid: destRepoid }).where(where);
  return { found: true, alreadyOwned: false, repoid: destRepoid };
}
