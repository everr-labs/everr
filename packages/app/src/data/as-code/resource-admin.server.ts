import { and, eq, isNull, ne, or } from "drizzle-orm";
import {
  fromCcRule,
  OWN_REPO,
  previewIdOf,
  toAlertRuleDocument,
} from "@/data/alerts/mapping";
import * as cc from "@/data/cc/client";
import type { CcRuleView, CcSloView } from "@/data/cc/types";
import { fromCcSlo, previewIdOfSlo, toSloDocument } from "@/data/slos/mapping";
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
  /**
   * RFC-3339 timestamp of the resource's last write. Postgres-backed kinds
   * serialize their `updated_at` column; alerts and SLOs surface the CC
   * entity's `updated_at` (maintained on create, spec update, pause/resume).
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
 * The org's live alert rules, unowned ones included: like the Postgres-backed
 * kinds, an engine/UI-created rule (no `everr.repoid`) is still a resource,
 * listed with `repoid: ""` and reachable by identity for delete/adopt
 * (adoption is exactly how an unowned rule becomes as-code). Only preview
 * copies are excluded.
 */
async function listLiveAlertRules(orgId: string): Promise<CcRuleView[]> {
  const rules = await cc.listAllRules(orgId);
  return rules.filter((r) => previewIdOf(r) === null);
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
): Promise<CcRuleView | null> {
  const rules = await listLiveAlertRules(orgId);
  return (
    rules.find((r) => {
      const view = fromCcRule(r);
      return view.project === project && view.slug === slug;
    }) ?? null
  );
}

/**
 * The clickety-clack-backed storage for alerts: a simple alert IS a CC rule
 * tagged `everr.repoid` (see data/alerts/apply.server.ts), so every operation
 * goes to the CC API instead of a Drizzle table. Alerts have no stored
 * document (the CC rule is the resource), so a canonical `kind: AlertRule`
 * document is reconstructed from the rule on read. Adoption rewrites the
 * rule's `everr.repoid` annotation via a version-guarded update, so instance
 * state survives it.
 */
const alertBackend: KindBackend = {
  async list(orgId, repoid) {
    const rules = await listLiveAlertRules(orgId);
    return rules
      .map((r) => ({ view: fromCcRule(r), updatedAt: r.updated_at }))
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
    await cc.deleteRule(orgId, rule.id);
    return true;
  },
  async adopt(orgId, project, slug, destRepoid) {
    const rule = await findAlertRule(orgId, project, slug);
    if (!rule) return { found: false, alreadyOwned: false };
    if (fromCcRule(rule).repoid === destRepoid) {
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

/**
 * The org's live SLOs, unowned ones included (see {@link listLiveAlertRules}:
 * same ownership semantics as the Postgres-backed kinds). Only preview copies
 * are excluded.
 */
async function listLiveSlos(orgId: string): Promise<CcSloView[]> {
  const slos = await cc.listSlos(orgId);
  return slos.filter((s) => previewIdOfSlo(s) === null);
}

/**
 * The live SLO for `(project, slug)`, or null. Matches on the parsed
 * identity rather than the formatted name (see {@link findAlertRule}).
 */
async function findSlo(
  orgId: string,
  project: string,
  slug: string,
): Promise<CcSloView | null> {
  const slos = await listLiveSlos(orgId);
  return (
    slos.find((s) => {
      const view = fromCcSlo(s);
      return view.project === project && view.slug === slug;
    }) ?? null
  );
}

/**
 * The clickety-clack-backed storage for SLOs, the exact analogue of
 * `alertBackend`: an as-code SLO IS a CC SLO tagged `everr.repoid` (see
 * data/slos/apply.server.ts). SLOs address by their first-class `name`
 * (project/slug qualified), have no stored document (a canonical `kind: SLO`
 * document is reconstructed from the spec on read), and adoption rewrites
 * `everr.repoid` via a version-guarded update so burn-rate instance state
 * survives it.
 */
const sloBackend: KindBackend = {
  async list(orgId, repoid) {
    const slos = await listLiveSlos(orgId);
    return slos
      .map((s) => ({ view: fromCcSlo(s), updatedAt: s.updated_at }))
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
    await cc.deleteSlo(orgId, slo.id);
    return true;
  },
  async adopt(orgId, project, slug, destRepoid) {
    const slo = await findSlo(orgId, project, slug);
    if (!slo) return { found: false, alreadyOwned: false };
    if (fromCcSlo(slo).repoid === destRepoid) {
      return { found: true, alreadyOwned: true };
    }
    await cc.updateSlo(
      orgId,
      slo.id,
      {
        ...slo.spec,
        annotations: { ...slo.spec.annotations, [OWN_REPO]: destRepoid },
      },
      slo.version,
    );
    return { found: true, alreadyOwned: false };
  },
};

/** Where each kind lives: dashboards and runbooks in Postgres, alerts and SLOs in CC. */
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
