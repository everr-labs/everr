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

const ALERT_PROJECT = "default";

export interface ResourceSummary {
  kind: ResourceKind;
  project: string;
  slug: string;
  /** "" for UI-created resources. */
  repoid: string;
  /**
   * RFC-3339 timestamp of the resource's last write. Postgres-backed kinds
   * serialize their `updated_at` column; alerts surface the CC rule's
   * `updated_at` (maintained on create, spec update, pause/resume).
   */
  updatedAt: string;
}

export interface ListFilters {
  kind?: ResourceKind;
  /** Exact owner match; "" selects UI-created. */
  repoid?: string;
}

export interface AdoptResult {
  found: boolean;
  alreadyOwned: boolean;
}

/** The per-kind storage operations the generic admin functions dispatch to. */
interface KindBackend {
  list(orgId: string, repoid: string | undefined): Promise<ResourceSummary[]>;
  get(orgId: string, project: string, slug: string): Promise<unknown | null>;
  delete(orgId: string, project: string, slug: string): Promise<boolean>;
  adopt(
    orgId: string,
    project: string,
    slug: string,
    destRepoid: string,
  ): Promise<AdoptResult>;
}

type PgTable = typeof dashboards | typeof runbooks;

// Drizzle infers a distinct row/table type per pgTable, so a value typed as
// `PgTable` can't be passed straight into `.select().from()` without the
// compiler losing track of column identity. The PG-backed tables are
// structurally compatible (same column shapes) but TS won't unify the union;
// this single localized cast at the backend boundary keeps behavior identical
// while satisfying the compiler.
type LiveTable = typeof dashboards;

/**
 * The Postgres-backed storage for one kind: dashboards and runbooks share this
 * implementation, parameterized by their table.
 */
function pgBackend(kind: ResourceKind, pgTable: PgTable): KindBackend {
  const table = pgTable as LiveTable;

  /**
   * Conditions scoping a query to a live row of the kind: the caller's org and
   * not a preview row.
   */
  const liveScope = (orgId: string) => [
    eq(table.organizationId, orgId),
    isNull(table.previewId),
  ];

  /** The full `(org, live, project, slug)` identity match for one live row. */
  const scopedRow = (orgId: string, project: string, slug: string) =>
    and(...liveScope(orgId), eq(table.project, project), eq(table.slug, slug));

  return {
    async list(orgId, repoid) {
      const conds = liveScope(orgId);
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
    },
    async get(orgId, project, slug) {
      const [row] = await db
        .select({ document: table.document })
        .from(table)
        .where(scopedRow(orgId, project, slug))
        .limit(1);
      return row?.document ?? null;
    },
    async delete(orgId, project, slug) {
      const result = await db
        .delete(table)
        .where(scopedRow(orgId, project, slug));
      return (result.rowCount ?? 0) > 0;
    },
    async adopt(orgId, project, slug, destRepoid) {
      const where = scopedRow(orgId, project, slug);
      // Flip ownership in one statement; the ownership guard leaves 0 rows only
      // for the rare not-found / already-owned cases, which the follow-up
      // select disambiguates.
      const updated = await db
        .update(table)
        .set({ repoid: destRepoid })
        .where(
          and(where, or(isNull(table.repoid), ne(table.repoid, destRepoid))),
        );
      if ((updated.rowCount ?? 0) > 0) {
        return { found: true, alreadyOwned: false };
      }
      const [existing] = await db
        .select({ repoid: table.repoid })
        .from(table)
        .where(where)
        .limit(1);
      if (!existing) return { found: false, alreadyOwned: false };
      return { found: true, alreadyOwned: true };
    },
  };
}

/**
 * The org's live as-code alert rules: everr-owned (tagged `everr.name`) and
 * not part of a preview namespace. Engine-only rules (no `everr.name`) are not
 * as-code resources and never surface here.
 */
async function listLiveAlertRules(orgId: string): Promise<CcRuleView[]> {
  const rules = await cc.listAllRules(orgId);
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

/**
 * The clickety-clack-backed storage for alerts: a simple alert IS a CC rule
 * tagged `everr.name` + `everr.repoid` (see data/alerts/apply.server.ts), so
 * every operation goes to the CC API instead of a Drizzle table. Alerts have
 * no project dimension in CC; they surface under the "default" project, and
 * alerts have no stored document (the CC rule is the resource), so a canonical
 * `kind: AlertRule` document is reconstructed from the rule's spec on read.
 * Adoption rewrites the rule's `everr.repoid` annotation via a version-guarded
 * update, so instance state survives it.
 */
const alertBackend: KindBackend = {
  async list(orgId, repoid) {
    const rules = await listLiveAlertRules(orgId);
    return rules
      .map((r) => ({ view: fromCcRuleSpec(r.spec), updatedAt: r.updated_at }))
      .filter(({ view }) => repoid === undefined || view.repoid === repoid)
      .map(({ view, updatedAt }) => ({
        kind: "alert" as const,
        project: ALERT_PROJECT,
        slug: view.slug,
        repoid: view.repoid,
        updatedAt,
      }));
  },
  async get(orgId, project, slug) {
    const rule = await findAlertRule(orgId, project, slug);
    return rule ? toAlertRuleDocument(rule.spec) : null;
  },
  async delete(orgId, project, slug) {
    const rule = await findAlertRule(orgId, project, slug);
    if (!rule) return false;
    await cc.deleteRule(orgId, rule.id);
    return true;
  },
  async adopt(orgId, project, slug, destRepoid) {
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
  },
};

/** Where each kind lives: dashboards and runbooks in Postgres, alerts in CC. */
const KIND_BACKENDS: Record<ResourceKind, KindBackend> = {
  dashboard: pgBackend("dashboard", dashboards),
  runbook: pgBackend("runbook", runbooks),
  alert: alertBackend,
};

export async function listResources(
  orgId: string,
  filters: ListFilters,
): Promise<ResourceSummary[]> {
  const kinds = filters.kind ? [filters.kind] : [...RESOURCE_KINDS];
  const perKind = await Promise.all(
    kinds.map((k) => KIND_BACKENDS[k].list(orgId, filters.repoid)),
  );
  return perKind.flat();
}

/**
 * The resource's as-code document, or null when it does not exist. Dashboards
 * and runbooks return their stored `document` JSON; alerts reconstruct a
 * canonical `kind: AlertRule` document from the CC rule's spec.
 */
export async function getResource(
  orgId: string,
  kind: ResourceKind,
  project: string,
  slug: string,
): Promise<unknown | null> {
  return KIND_BACKENDS[kind].get(orgId, project, slug);
}

/** True when a resource was deleted, false when none matched. */
export async function deleteResource(
  orgId: string,
  kind: ResourceKind,
  project: string,
  slug: string,
): Promise<boolean> {
  return KIND_BACKENDS[kind].delete(orgId, project, slug);
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
  return KIND_BACKENDS[kind].adopt(orgId, project, slug, destRepoid);
}
