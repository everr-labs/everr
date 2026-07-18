import { and, eq, inArray } from "drizzle-orm";
import * as cc from "@/data/cc/client";
import { db } from "@/db/client";
import { previews } from "@/db/schema";
import { createLimiter } from "@/lib/limiter";
import { errorMessage, serverLogger } from "@/telemetry/logger";
import { previewIdOf } from "./mapping";

/** At most this many orphan rules are deleted per org per sweep run. */
const ORPHAN_SWEEP_CAP_PER_ORG = 100;

/** Cap on in-flight CC delete calls while clearing a batch of rule ids. */
const DELETE_CONCURRENCY = 8;

/**
 * Delete the given CC rule ids for one org, at most `cap` of them (0 = no cap).
 * Shared by the on-delete fast path and the periodic sweep. Deletes run in a
 * bounded pool; every one is attempted and the first failure (in input order)
 * is rethrown, so callers keep their existing catch-and-log handling. Returns
 * how many were deleted and whether the cap clipped the list.
 */
async function deleteCcRules(
  orgId: string,
  ruleIds: readonly string[],
  cap = 0,
): Promise<{ deleted: number; capped: boolean }> {
  const capped = cap > 0 && ruleIds.length > cap;
  const targets = capped ? ruleIds.slice(0, cap) : ruleIds;
  const runDelete = createLimiter(DELETE_CONCURRENCY);
  const results = await Promise.allSettled(
    targets.map((id) => runDelete(undefined, () => cc.deleteRule(orgId, id))),
  );
  const failure = results.find((r) => r.status === "rejected");
  if (failure) throw failure.reason;
  return { deleted: targets.length, capped };
}

/**
 * Best-effort removal of the suppressed CC rules left behind by deleted
 * previews: list each affected org's rules and delete every one whose
 * everr.preview annotation names a deleted preview id.
 *
 * Called AFTER the preview registry rows are gone. Row-first ordering keeps
 * the Postgres delete authoritative (its predicate already guards against a
 * concurrent re-apply refreshing lastAppliedAt, so we never tear down the CC
 * rules of a preview that just came back to life) and means a CC outage can
 * never block retention. The tradeoff: if CC is unreachable here, the
 * suppressed rules are orphaned (they keep evaluating but never notify) with
 * no immediate retry — {@link sweepOrphanCcRules} is the periodic backstop
 * that eventually reaps them.
 */
export async function deletePreviewCcRules(
  deleted: readonly { id: string; organizationId: string }[],
): Promise<void> {
  const byOrg = new Map<string, Set<string>>();
  for (const p of deleted) {
    const ids = byOrg.get(p.organizationId) ?? new Set<string>();
    ids.add(p.id);
    byOrg.set(p.organizationId, ids);
  }
  for (const [orgId, previewIds] of byOrg) {
    try {
      const rules = await cc.listAllRules(orgId);
      const ruleIds = rules
        .filter((rule) => {
          const previewId = previewIdOf(rule.spec);
          return previewId !== null && previewIds.has(previewId);
        })
        .map((rule) => rule.id);
      await deleteCcRules(orgId, ruleIds);
    } catch (error) {
      serverLogger.error("previews.cc_cleanup.failed", {
        "organization.id": orgId,
        "previews.ids": [...previewIds].join(","),
        "error.message": errorMessage(error),
      });
    }
  }
}

/**
 * The Postgres reads the orphan sweep needs, behind an interface so the
 * decision logic can be unit-tested with a fake (the CC client is mocked at
 * the module boundary, like the rest of this file's tests).
 */
export interface OrphanSweepDb {
  /** Distinct orgs with at least one preview registry row. */
  listPreviewOrgs(): Promise<string[]>;
  /**
   * Which of `ids` still exist as registry rows for `orgId`. Read AFTER the CC
   * listing so it is the race-guard snapshot (see {@link sweepOrphanCcRules}).
   */
  existingPreviewIds(
    orgId: string,
    ids: readonly string[],
  ): Promise<Set<string>>;
}

const productionDb: OrphanSweepDb = {
  async listPreviewOrgs() {
    const rows = await db
      .selectDistinct({ organizationId: previews.organizationId })
      .from(previews);
    return rows.map((row) => row.organizationId);
  },
  async existingPreviewIds(orgId, ids) {
    if (ids.length === 0) return new Set();
    const rows = await db
      .select({ id: previews.id })
      .from(previews)
      .where(
        and(eq(previews.organizationId, orgId), inArray(previews.id, [...ids])),
      );
    return new Set(rows.map((row) => row.id));
  },
};

/**
 * Durable backstop for the on-delete fast path: reaps suppressed CC rules whose
 * everr.preview annotation names a preview that no longer exists in the
 * registry. These accumulate when {@link deletePreviewCcRules} could not reach
 * CC at deletion time; left alone they evaluate forever and never notify.
 *
 * Scope: every org that still has at least one preview registry row — the orgs
 * where preview churn (and therefore orphaning) realistically happens. An org
 * that deleted its last preview while CC was down keeps its orphans until it
 * next applies a preview; that is an accepted, rare gap, not worth listing CC
 * for every tenant in the system.
 *
 * Race guard: for each org we list the CC rules FIRST, then snapshot the
 * registry. A preview created between the two reads writes its registry row
 * before its CC rules (see upsertPreview → reconcile ordering), so any rule we
 * listed has its parent row present in the snapshot and is retained. We only
 * ever delete a rule whose annotation id is absent from a registry snapshot
 * taken strictly after the list.
 *
 * CC unavailability is tolerated per org: a failing org is logged and skipped,
 * and the next hourly run retries it. Deletions are capped per org per run so a
 * pathological backlog cannot monopolize a single run.
 */
export async function sweepOrphanCcRules(
  sweepDb: OrphanSweepDb = productionDb,
): Promise<void> {
  const orgs = await sweepDb.listPreviewOrgs();
  for (const orgId of orgs) {
    try {
      // List first — the registry snapshot below must be strictly newer.
      const rules = await cc.listAllRules(orgId);
      const referenced = new Set<string>();
      for (const rule of rules) {
        const previewId = previewIdOf(rule.spec);
        if (previewId !== null) referenced.add(previewId);
      }
      if (referenced.size === 0) continue;

      const live = await sweepDb.existingPreviewIds(orgId, [...referenced]);
      const orphanRuleIds = rules
        .filter((rule) => {
          const previewId = previewIdOf(rule.spec);
          return previewId !== null && !live.has(previewId);
        })
        .map((rule) => rule.id);
      if (orphanRuleIds.length === 0) continue;

      const { deleted, capped } = await deleteCcRules(
        orgId,
        orphanRuleIds,
        ORPHAN_SWEEP_CAP_PER_ORG,
      );
      serverLogger.info("previews.cc_orphan_sweep.swept", {
        "organization.id": orgId,
        "previews.orphan_rules_deleted": deleted,
        "previews.orphan_sweep_capped": capped,
      });
    } catch (error) {
      serverLogger.error("previews.cc_orphan_sweep.failed", {
        "organization.id": orgId,
        "error.message": errorMessage(error),
      });
    }
  }
}
