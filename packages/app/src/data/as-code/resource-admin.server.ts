import { and, eq, isNull, ne, or } from "drizzle-orm";
import {
  fromCcRuleSpec,
  isOwnedRule,
  OWN_REPO,
  previewIdOf,
  toAlertRuleDocument,
} from "@/data/alerts/mapping";
import * as cc from "@/data/cc/client";
import type { CcRuleView } from "@/data/cc/types";
import { db } from "@/db/client";
import { dashboards, runbooks } from "@/db/schema/app";

export const RESOURCE_KINDS = ["dashboard", "runbook", "alert"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export function isResourceKind(value: string): value is ResourceKind {
  return (RESOURCE_KINDS as readonly string[]).includes(value);
}

/**
 * Dashboards and runbooks live in Postgres; alerts live in clickety-clack (a
 * simple alert IS a CC rule tagged `everr.name` + `everr.repoid`, see
 * data/alerts/apply.server.ts), so the alert kind routes to the CC API instead
 * of a Drizzle table. Alerts have no project dimension in CC; they surface
 * under the "default" project.
 */
const PG_KIND_TABLES = {
  dashboard: { table: dashboards },
  runbook: { table: runbooks },
} as const;

type PgKind = keyof typeof PG_KIND_TABLES;

const ALERT_PROJECT = "default";

// Drizzle infers a distinct row/table type per pgTable, so a value typed as
// `PgTable` can't be passed straight into `.select().from()` without the
// compiler losing track of column identity. The PG_KIND_TABLES values are
// structurally compatible (same column shapes) but TS won't unify the union;
// this single localized cast at the query boundary keeps behavior identical
// while satisfying the compiler.
type LiveTable = typeof dashboards;

function tableFor(kind: PgKind): LiveTable {
  return PG_KIND_TABLES[kind].table as LiveTable;
}

export interface ResourceSummary {
  kind: ResourceKind;
  project: string;
  slug: string;
  /** "" for UI-created resources. */
  repoid: string;
  /** "" for alerts: CC rules carry no timestamps. */
  updatedAt: string;
}

export interface ListFilters {
  kind?: ResourceKind;
  /** Exact owner match; "" selects UI-created. */
  repoid?: string;
}

/**
 * Conditions scoping a query to a live row of `kind`: the caller's org and not
 * a preview row.
 */
function liveScope(kind: PgKind, orgId: string) {
  const table = tableFor(kind);
  return [eq(table.organizationId, orgId), isNull(table.previewId)];
}

/** The full `(org, live, project, slug)` identity match for one live row. */
function scopedRow(kind: PgKind, orgId: string, project: string, slug: string) {
  const table = tableFor(kind);
  return and(
    ...liveScope(kind, orgId),
    eq(table.project, project),
    eq(table.slug, slug),
  );
}

/**
 * The org's live as-code alert rules: everr-owned (tagged `everr.name`) and
 * not part of a preview namespace. Engine-only rules (no `everr.name`) are not
 * as-code resources and never surface here.
 */
async function listLiveAlertRules(orgId: string): Promise<CcRuleView[]> {
  const rules = await cc.listRules(orgId);
  return rules.filter(
    (r) => isOwnedRule(r.spec) && previewIdOf(r.spec) === null,
  );
}

/** The live as-code alert rule for `(project, slug)`, or null. */
async function findAlertRule(
  orgId: string,
  project: string,
  slug: string,
): Promise<CcRuleView | null> {
  if (project !== ALERT_PROJECT) return null;
  const rules = await listLiveAlertRules(orgId);
  return rules.find((r) => fromCcRuleSpec(r.spec).slug === slug) ?? null;
}

async function listAlertResources(
  orgId: string,
  repoid: string | undefined,
): Promise<ResourceSummary[]> {
  const rules = await listLiveAlertRules(orgId);
  return rules
    .map((r) => fromCcRuleSpec(r.spec))
    .filter((view) => repoid === undefined || view.repoid === repoid)
    .map((view) => ({
      kind: "alert" as const,
      project: ALERT_PROJECT,
      slug: view.slug,
      repoid: view.repoid,
      updatedAt: "",
    }));
}

async function listOneKind(
  orgId: string,
  kind: ResourceKind,
  repoid: string | undefined,
): Promise<ResourceSummary[]> {
  if (kind === "alert") return listAlertResources(orgId, repoid);
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

/**
 * The resource's as-code document, or null when it does not exist. Dashboards
 * and runbooks return their stored `document` JSON; alerts have no stored
 * document (the CC rule is the resource), so a canonical `kind: AlertRule`
 * document is reconstructed from the rule's spec.
 */
export async function getResource(
  orgId: string,
  kind: ResourceKind,
  project: string,
  slug: string,
): Promise<unknown | null> {
  if (kind === "alert") {
    const rule = await findAlertRule(orgId, project, slug);
    return rule ? toAlertRuleDocument(rule.spec) : null;
  }
  const table = tableFor(kind);
  const [row] = await db
    .select({ document: table.document })
    .from(table)
    .where(scopedRow(kind, orgId, project, slug))
    .limit(1);
  return row?.document ?? null;
}

/** True when a resource was deleted, false when none matched. */
export async function deleteResource(
  orgId: string,
  kind: ResourceKind,
  project: string,
  slug: string,
): Promise<boolean> {
  if (kind === "alert") {
    const rule = await findAlertRule(orgId, project, slug);
    if (!rule) return false;
    await cc.deleteRule(orgId, rule.id);
    return true;
  }
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
 * matches, alreadyOwned=true when it was already owned by destRepoid. For
 * alerts the flip rewrites the rule's `everr.repoid` annotation via a
 * version-guarded update, so instance state survives adoption.
 */
export async function adoptResource(
  orgId: string,
  kind: ResourceKind,
  project: string,
  slug: string,
  destRepoid: string,
): Promise<AdoptResult> {
  if (kind === "alert") {
    const rule = await findAlertRule(orgId, project, slug);
    if (!rule) return { found: false, alreadyOwned: false };
    if (fromCcRuleSpec(rule.spec).repoid === destRepoid) {
      return { found: true, alreadyOwned: true };
    }
    await cc.updateRule(
      orgId,
      rule.id,
      {
        ...rule.spec,
        annotations: { ...rule.spec.annotations, [OWN_REPO]: destRepoid },
      },
      rule.version,
    );
    return { found: true, alreadyOwned: false };
  }
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
