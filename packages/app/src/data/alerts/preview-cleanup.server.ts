import { and, eq, inArray } from "drizzle-orm";
import * as cc from "@/data/cc/client";
import { previewIdOfSlo } from "@/data/slos/mapping";
import { db } from "@/db/client";
import { ccCleanupPending, previews } from "@/db/schema";
import { createLimiter } from "@/lib/limiter";
import { errorMessage, serverLogger } from "@/telemetry/logger";
import { previewIdOf } from "./mapping";

/**
 * At most this many orphan rules, and separately this many orphan SLOs, are
 * deleted per org per sweep run. Rules and SLOs are unrelated CC resources
 * with independent listings and deletions, so the cap is applied per resource
 * kind rather than shared: a pathological rule backlog should not starve the
 * SLO sweep for the same org in one run, or vice versa.
 */
const ORPHAN_SWEEP_CAP_PER_ORG = 100;

/** Cap on in-flight CC delete calls while clearing a batch of resource ids. */
const DELETE_CONCURRENCY = 8;

/**
 * Delete the given CC resource ids for one org via `deleteFn`, at most `cap`
 * of them (0 = no cap). Shared by the rule and SLO cleanup paths (both the
 * on-delete fast path and the periodic sweep). Deletes run in a bounded pool;
 * every one is attempted and the first failure (in input order) is rethrown,
 * so callers keep their existing catch-and-log handling. Returns how many
 * were deleted and whether the cap clipped the list.
 */
async function deleteCcResources(
  orgId: string,
  ids: readonly string[],
  deleteFn: (orgId: string, id: string) => Promise<unknown>,
  cap = 0,
): Promise<{ deleted: number; capped: boolean }> {
  const capped = cap > 0 && ids.length > cap;
  const targets = capped ? ids.slice(0, cap) : ids;
  const runDelete = createLimiter(DELETE_CONCURRENCY);
  const results = await Promise.allSettled(
    targets.map((id) => runDelete(undefined, () => deleteFn(orgId, id))),
  );
  const failure = results.find((r) => r.status === "rejected");
  if (failure) throw failure.reason;
  return { deleted: targets.length, capped };
}

function deleteCcRules(orgId: string, ruleIds: readonly string[], cap = 0) {
  return deleteCcResources(orgId, ruleIds, cc.deleteRule, cap);
}

function deleteCcSlos(orgId: string, sloIds: readonly string[], cap = 0) {
  return deleteCcResources(orgId, sloIds, cc.deleteSlo, cap);
}

/**
 * Best-effort removal of the suppressed CC rules and SLOs left behind by
 * deleted previews: list each affected org's rules and SLOs and delete every
 * one whose `namespace` names a deleted preview id.
 *
 * Called AFTER the preview registry rows are gone. Row-first ordering keeps
 * the Postgres delete authoritative (its predicate already guards against a
 * concurrent re-apply refreshing lastAppliedAt, so we never tear down the CC
 * rules/SLOs of a preview that just came back to life) and means a CC outage
 * can never block retention. The tradeoff: if CC is unreachable here, the
 * suppressed rules/SLOs are orphaned (they keep evaluating but never notify)
 * with no immediate retry — {@link sweepOrphanCcRules} is the periodic
 * backstop that eventually reaps them.
 *
 * Listing failures (rules or SLOs) abort both resource kinds for that org, one
 * log, same as before this function knew about SLOs. Once listing succeeds,
 * rule deletion and SLO deletion are attempted independently: a delete
 * failure for one resource kind is logged but does not block the other kind's
 * cleanup for the same org.
 */
export async function deletePreviewCcRules(
  deleted: readonly { id: string; organizationId: string }[],
  ledger: Pick<OrphanSweepDb, "markCleanupPending"> = productionDb,
): Promise<void> {
  const byOrg = new Map<string, Set<string>>();
  for (const p of deleted) {
    const ids = byOrg.get(p.organizationId) ?? new Set<string>();
    ids.add(p.id);
    byOrg.set(p.organizationId, ids);
  }
  for (const [orgId, previewIds] of byOrg) {
    let rules: Awaited<ReturnType<typeof cc.listAllRules>>;
    let slos: Awaited<ReturnType<typeof cc.listSlos>>;
    try {
      rules = await cc.listAllRules(orgId);
      slos = await cc.listSlos(orgId);
    } catch (error) {
      serverLogger.error("previews.cc_cleanup.failed", {
        "organization.id": orgId,
        "previews.ids": [...previewIds].join(","),
        "error.message": errorMessage(error),
      });
      await markPending(ledger, orgId);
      continue;
    }

    try {
      const ruleIds = rules
        .filter((rule) => {
          const previewId = previewIdOf(rule);
          return previewId !== null && previewIds.has(previewId);
        })
        .map((rule) => rule.id);
      await deleteCcRules(orgId, ruleIds);
    } catch (error) {
      serverLogger.error("previews.cc_cleanup.failed", {
        "organization.id": orgId,
        "previews.ids": [...previewIds].join(","),
        "resource.kind": "rule",
        "error.message": errorMessage(error),
      });
      await markPending(ledger, orgId);
    }

    try {
      const sloIds = slos
        .filter((slo) => {
          const previewId = previewIdOfSlo(slo);
          return previewId !== null && previewIds.has(previewId);
        })
        .map((slo) => slo.id);
      await deleteCcSlos(orgId, sloIds);
    } catch (error) {
      serverLogger.error("previews.cc_cleanup.failed", {
        "organization.id": orgId,
        "previews.ids": [...previewIds].join(","),
        "resource.kind": "slo",
        "error.message": errorMessage(error),
      });
      await markPending(ledger, orgId);
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
  /**
   * Orgs flagged because a CC cleanup failed or was capped
   * (`cc_cleanup_pending`). The sweep visits these even when they no longer
   * hold any preview row, so an org whose LAST preview died during a CC
   * outage is still revisited.
   */
  listPendingCleanupOrgs(): Promise<string[]>;
  /** Flag `orgId` for revisiting; idempotent. */
  markCleanupPending(orgId: string): Promise<void>;
  /** Clear the flag once a sweep pass over `orgId` completes cleanly. */
  clearCleanupPending(orgId: string): Promise<void>;
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
  async listPendingCleanupOrgs() {
    const rows = await db
      .select({ organizationId: ccCleanupPending.organizationId })
      .from(ccCleanupPending);
    return rows.map((row) => row.organizationId);
  },
  async markCleanupPending(orgId) {
    await db
      .insert(ccCleanupPending)
      .values({ organizationId: orgId })
      .onConflictDoNothing();
  },
  async clearCleanupPending(orgId) {
    await db
      .delete(ccCleanupPending)
      .where(eq(ccCleanupPending.organizationId, orgId));
  },
};

/** Best-effort ledger writes: a failing marker must never break cleanup. */
async function markPending(
  ledger: Pick<OrphanSweepDb, "markCleanupPending">,
  orgId: string,
): Promise<void> {
  try {
    await ledger.markCleanupPending(orgId);
  } catch (error) {
    serverLogger.error("previews.cc_cleanup.mark_pending_failed", {
      "organization.id": orgId,
      "error.message": errorMessage(error),
    });
  }
}

async function clearPending(
  ledger: Pick<OrphanSweepDb, "clearCleanupPending">,
  orgId: string,
): Promise<void> {
  try {
    await ledger.clearCleanupPending(orgId);
  } catch (error) {
    serverLogger.error("previews.cc_cleanup.clear_pending_failed", {
      "organization.id": orgId,
      "error.message": errorMessage(error),
    });
  }
}

/**
 * Durable backstop for the on-delete fast path: reaps suppressed CC rules and
 * SLOs whose `namespace` names a preview that no longer exists in the
 * registry. These accumulate when {@link deletePreviewCcRules} could not reach
 * CC at deletion time; left alone they evaluate forever and never notify.
 *
 * Scope: every org that still has at least one preview registry row — the orgs
 * where preview churn (and therefore orphaning) realistically happens — plus
 * every org on the `cc_cleanup_pending` ledger. The ledger is written whenever
 * a CC cleanup fails or a sweep pass is incomplete, and cleared by a clean
 * pass, so an org that deleted its LAST preview while CC was down is still
 * revisited (the old behavior silently stranded it forever). Listing CC for
 * every tenant in the system stays off the table; the ledger names exactly
 * the orgs that need another look.
 *
 * Race guard: for each org we list the CC rules and SLOs FIRST, then snapshot
 * the registry once, covering ids referenced by either resource kind. A
 * preview created between the two reads writes its registry row before its CC
 * rules/SLOs (see upsertPreview → reconcile ordering), so anything we listed
 * has its parent row present in the snapshot and is retained. We only ever
 * delete a rule or SLO whose namespace is absent from a registry snapshot
 * taken strictly after both lists.
 *
 * CC unavailability while listing is tolerated per org: a failing org is
 * logged and skipped, and the next hourly run retries it. Once listing
 * succeeds, rule deletion and SLO deletion are attempted independently, each
 * capped at {@link ORPHAN_SWEEP_CAP_PER_ORG} per org per run (see that
 * constant for why the cap is per resource kind, not shared). A failure
 * deleting one kind is logged but does not block the other kind's sweep for
 * the same org.
 */
export async function sweepOrphanCcRules(
  sweepDb: OrphanSweepDb = productionDb,
): Promise<void> {
  const [previewOrgs, pendingOrgs] = await Promise.all([
    sweepDb.listPreviewOrgs(),
    sweepDb.listPendingCleanupOrgs(),
  ]);
  const orgs = [...new Set([...previewOrgs, ...pendingOrgs])];
  for (const orgId of orgs) {
    try {
      // List first — the registry snapshot below must be strictly newer.
      const rules = await cc.listAllRules(orgId);
      const slos = await cc.listSlos(orgId);
      const referenced = new Set<string>();
      for (const rule of rules) {
        const previewId = previewIdOf(rule);
        if (previewId !== null) referenced.add(previewId);
      }
      for (const slo of slos) {
        const previewId = previewIdOfSlo(slo);
        if (previewId !== null) referenced.add(previewId);
      }
      if (referenced.size === 0) {
        // Nothing preview-tagged left in CC: this org is fully clean.
        await clearPending(sweepDb, orgId);
        continue;
      }

      const live = await sweepDb.existingPreviewIds(orgId, [...referenced]);
      const orphanRuleIds = rules
        .filter((rule) => {
          const previewId = previewIdOf(rule);
          return previewId !== null && !live.has(previewId);
        })
        .map((rule) => rule.id);
      const orphanSloIds = slos
        .filter((slo) => {
          const previewId = previewIdOfSlo(slo);
          return previewId !== null && !live.has(previewId);
        })
        .map((slo) => slo.id);
      if (orphanRuleIds.length === 0 && orphanSloIds.length === 0) {
        // Every preview-tagged resource still has its registry row: no
        // orphans, nothing pending for this org.
        await clearPending(sweepDb, orgId);
        continue;
      }

      let failed = false;
      let ruleResult = { deleted: 0, capped: false };
      if (orphanRuleIds.length > 0) {
        try {
          ruleResult = await deleteCcRules(
            orgId,
            orphanRuleIds,
            ORPHAN_SWEEP_CAP_PER_ORG,
          );
        } catch (error) {
          failed = true;
          serverLogger.error("previews.cc_orphan_sweep.failed", {
            "organization.id": orgId,
            "resource.kind": "rule",
            "error.message": errorMessage(error),
          });
        }
      }

      let sloResult = { deleted: 0, capped: false };
      if (orphanSloIds.length > 0) {
        try {
          sloResult = await deleteCcSlos(
            orgId,
            orphanSloIds,
            ORPHAN_SWEEP_CAP_PER_ORG,
          );
        } catch (error) {
          failed = true;
          serverLogger.error("previews.cc_orphan_sweep.failed", {
            "organization.id": orgId,
            "resource.kind": "slo",
            "error.message": errorMessage(error),
          });
        }
      }

      serverLogger.info("previews.cc_orphan_sweep.swept", {
        "organization.id": orgId,
        "previews.orphan_rules_deleted": ruleResult.deleted,
        "previews.orphan_sweep_capped": ruleResult.capped,
        "previews.orphan_slos_deleted": sloResult.deleted,
        "previews.orphan_slos_sweep_capped": sloResult.capped,
      });
      // An incomplete pass (failure or cap) keeps the org on the pending
      // ledger so the next run revisits it even after its last preview row
      // is gone; a complete pass clears it.
      if (failed || ruleResult.capped || sloResult.capped) {
        await markPending(sweepDb, orgId);
      } else {
        await clearPending(sweepDb, orgId);
      }
    } catch (error) {
      serverLogger.error("previews.cc_orphan_sweep.failed", {
        "organization.id": orgId,
        "error.message": errorMessage(error),
      });
      await markPending(sweepDb, orgId);
    }
  }
}
