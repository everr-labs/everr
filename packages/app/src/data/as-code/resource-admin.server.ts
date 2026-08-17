import { and, eq, isNull, ne, or } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { BUILTIN_PROJECT } from "@/data/dashboards/schema";
import { db } from "@/db/client";
import { alertDefinitions } from "@/db/schema/alerts";
import { dashboards, runbooks } from "@/db/schema/app";

export const RESOURCE_KINDS = ["dashboard", "runbook", "alert"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/**
 * Thrown by every mutating function when the target names the reserved
 * `built-in` pseudo-project (ADR 0004). Centralized here so a new write verb
 * inherits the invariant instead of remembering its own route-level check;
 * routes translate this to a 403.
 */
export class ReservedProjectError extends Error {
  constructor(action: string) {
    super(`built-in dashboards ship with Everr and cannot be ${action}`);
    this.name = "ReservedProjectError";
  }
}

function rejectReservedProject(project: string, action: string): void {
  if (project === BUILTIN_PROJECT) throw new ReservedProjectError(action);
}

export function isResourceKind(value: string): value is ResourceKind {
  return (RESOURCE_KINDS as readonly string[]).includes(value);
}

/**
 * The Drizzle table backing each kind, plus its soft-delete marker when it has
 * one. Only `alertDefinitions` carries a legacy `deletedAt`, which the rest of
 * the codebase always excludes when reading "live" alerts (see
 * data/alerts/server.ts).
 */
const KIND_TABLES: Record<
  ResourceKind,
  { table: unknown; deletedAt?: PgColumn }
> = {
  dashboard: { table: dashboards },
  runbook: { table: runbooks },
  alert: { table: alertDefinitions, deletedAt: alertDefinitions.deletedAt },
};

// Drizzle infers a distinct row/table type per pgTable, so a value typed as
// `PgTable` can't be passed straight into `.select().from()` without the
// compiler losing track of column identity. The KIND_TABLES values are
// structurally compatible (same column shapes) but TS won't unify the union;
// this single localized cast at the query boundary keeps behavior identical
// while satisfying the compiler.
type LiveTable = typeof dashboards;

function tableFor(kind: ResourceKind): LiveTable {
  return KIND_TABLES[kind].table as LiveTable;
}

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

/**
 * Conditions scoping a query to a live row of `kind`: the caller's org, not a
 * preview row, and not soft-deleted (for kinds with a soft-delete marker).
 */
function liveScope(kind: ResourceKind, orgId: string) {
  const table = tableFor(kind);
  const conds = [eq(table.organizationId, orgId), isNull(table.previewId)];
  const { deletedAt } = KIND_TABLES[kind];
  if (deletedAt) conds.push(isNull(deletedAt));
  return conds;
}

/** The full `(org, live, project, slug)` identity match for one live row. */
function scopedRow(
  kind: ResourceKind,
  orgId: string,
  project: string,
  slug: string,
) {
  const table = tableFor(kind);
  return and(
    ...liveScope(kind, orgId),
    eq(table.project, project),
    eq(table.slug, slug),
  );
}

async function listOneKind(
  orgId: string,
  kind: ResourceKind,
  repoid: string | undefined,
): Promise<ResourceSummary[]> {
  const table = tableFor(kind);
  const conds = liveScope(kind, orgId);
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
  const table = tableFor(kind);
  const [row] = await db
    .select({ document: table.document })
    .from(table)
    .where(scopedRow(kind, orgId, project, slug))
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
  rejectReservedProject(project, "deleted");
  const result = await db
    .delete(tableFor(kind))
    .where(scopedRow(kind, orgId, project, slug));
  return (result.rowCount ?? 0) > 0;
}

export interface AdoptResult {
  found: boolean;
  alreadyOwned: boolean;
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
  rejectReservedProject(project, "adopted");
  const table = tableFor(kind);
  const where = scopedRow(kind, orgId, project, slug);
  // Flip ownership in one statement; the ownership guard leaves 0 rows only
  // for the rare not-found / already-owned cases, which the follow-up select
  // disambiguates.
  const updated = await db
    .update(table)
    .set({ repoid: destRepoid })
    .where(and(where, or(isNull(table.repoid), ne(table.repoid, destRepoid))));
  if ((updated.rowCount ?? 0) > 0) return { found: true, alreadyOwned: false };
  const [existing] = await db
    .select({ repoid: table.repoid })
    .from(table)
    .where(where)
    .limit(1);
  if (!existing) return { found: false, alreadyOwned: false };
  return { found: true, alreadyOwned: true };
}
