import { and, eq, isNull, ne, or } from "drizzle-orm";
import * as alertRules from "@/data/alerting/rules/repository";
import {
  fromAlertingRule,
  toAlertRuleDocument,
} from "@/data/alerting/rules/resource/mapping";
import * as slos from "@/data/alerting/slos/repository";
import {
  fromAlertingSlo,
  toSloDocument,
} from "@/data/alerting/slos/resource/mapping";
import type { AlertingRuleView, AlertingSloView } from "@/data/alerting/types";
import { db } from "@/db/client";
import { dashboards, runbooks } from "@/db/schema/app";

export const RESOURCE_KINDS = ["dashboard", "runbook", "alert", "slo"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export function isResourceKind(value: string): value is ResourceKind {
  return (RESOURCE_KINDS as readonly string[]).includes(value);
}

export interface ResourceSummary {
  kind: ResourceKind;
  project: string;
  slug: string;
  /** "" for UI-created resources. */
  repoid: string;
  /** RFC-3339 timestamp of the resource's last write. */
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
 * The org's live alert rules. Only preview copies are excluded.
 */
async function listLiveAlertRules(orgId: string): Promise<AlertingRuleView[]> {
  const rules = await alertRules.listAllRules(orgId);
  return rules.filter((r) => r.previewId === null);
}

/**
 * The live alert rule for `(project, slug)`, or null. Matches on the parsed
 * identity rather than the formatted name so an unqualified engine-native
 * name resolves under its implied "default" project.
 */
async function findAlertRule(
  orgId: string,
  project: string,
  slug: string,
): Promise<AlertingRuleView | null> {
  const rules = await listLiveAlertRules(orgId);
  return (
    rules.find((r) => {
      const view = fromAlertingRule(r);
      return view.project === project && view.slug === slug;
    }) ?? null
  );
}

/**
 * Alerts store ownership in a first-class `repoid` column. A canonical
 * `kind: AlertRule` document is reconstructed from the stored definition.
 */
const alertBackend: KindBackend = {
  async list(orgId, repoid) {
    const rules = await listLiveAlertRules(orgId);
    return rules
      .map((r) => ({ view: fromAlertingRule(r), updatedAt: r.updated_at }))
      .filter(({ view }) => repoid === undefined || view.repoid === repoid)
      .map(({ view, updatedAt }) => ({
        kind: "alert" as const,
        project: view.project,
        slug: view.slug,
        repoid: view.repoid,
        updatedAt,
      }));
  },
  async get(orgId, project, slug) {
    const rule = await findAlertRule(orgId, project, slug);
    return rule ? toAlertRuleDocument(rule) : null;
  },
  async delete(orgId, project, slug) {
    const rule = await findAlertRule(orgId, project, slug);
    if (!rule) return false;
    await alertRules.deleteRule(orgId, rule.id);
    return true;
  },
  async adopt(orgId, project, slug, destRepoid) {
    const rule = await findAlertRule(orgId, project, slug);
    if (!rule) return { found: false, alreadyOwned: false };
    if (fromAlertingRule(rule).repoid === destRepoid) {
      return { found: true, alreadyOwned: true };
    }
    await alertRules.adoptRule(orgId, rule.id, destRepoid, rule.version);
    return { found: true, alreadyOwned: false };
  },
};

/**
 * The org's live SLOs. Only preview copies are excluded.
 */
async function listLiveSlos(orgId: string): Promise<AlertingSloView[]> {
  const definitions = await slos.listSlos(orgId);
  return definitions.filter((slo) => slo.previewId === null);
}

/**
 * The live SLO for `(project, slug)`, or null. Matches on the parsed
 * identity rather than the formatted name (see {@link findAlertRule}).
 */
async function findSlo(
  orgId: string,
  project: string,
  slug: string,
): Promise<AlertingSloView | null> {
  const slos = await listLiveSlos(orgId);
  return (
    slos.find((s) => {
      const view = fromAlertingSlo(s);
      return view.project === project && view.slug === slug;
    }) ?? null
  );
}

/**
 * The Postgres-backed storage for SLOs, the exact analogue of
 * `alertBackend`: an as-code SLO is stored with first-class ownership. SLOs
 * address by their first-class `name`
 * (project/slug qualified), have no stored document (a canonical `kind: SLO`
 * document is reconstructed from the spec on read).
 */
const sloBackend: KindBackend = {
  async list(orgId, repoid) {
    const slos = await listLiveSlos(orgId);
    return slos
      .map((s) => ({ view: fromAlertingSlo(s), updatedAt: s.updated_at }))
      .filter(({ view }) => repoid === undefined || view.repoid === repoid)
      .map(({ view, updatedAt }) => ({
        kind: "slo" as const,
        project: view.project,
        slug: view.slug,
        repoid: view.repoid,
        updatedAt,
      }));
  },
  async get(orgId, project, slug) {
    const slo = await findSlo(orgId, project, slug);
    return slo ? toSloDocument(slo) : null;
  },
  async delete(orgId, project, slug) {
    const slo = await findSlo(orgId, project, slug);
    if (!slo) return false;
    await slos.deleteSlo(orgId, slo.id);
    return true;
  },
  async adopt(orgId, project, slug, destRepoid) {
    const slo = await findSlo(orgId, project, slug);
    if (!slo) return { found: false, alreadyOwned: false };
    if (fromAlertingSlo(slo).repoid === destRepoid) {
      return { found: true, alreadyOwned: true };
    }
    await slos.adoptSlo(orgId, slo.id, destRepoid, slo.version);
    return { found: true, alreadyOwned: false };
  },
};

// Document resources use their tables; alerts and SLOs use domain repositories.
const KIND_BACKENDS: Record<ResourceKind, KindBackend> = {
  dashboard: pgBackend("dashboard", dashboards),
  runbook: pgBackend("runbook", runbooks),
  alert: alertBackend,
  slo: sloBackend,
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

/** Returns the canonical as-code document, or null when it does not exist. */
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
