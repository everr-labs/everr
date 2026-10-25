import { enqueueMembershipSyncs } from "./membership-jobs";
import type { DeletionCleanup } from "./deletion";
import type { createBrevoAdapter } from "./brevo/adapter";
import {
  ORGANIZATION_SYNC_TASK,
  USER_SYNC_RETRIES,
  relatedSyncSpec,
  type OrganizationSyncPayload,
} from "./commands";
import type { createCrmSnapshotReader } from "./snapshots";
import type { createCrmProjectionStore } from "./store";
import { reconciliationDiagnostic, syncDiagnostic, type SyncDiagnostic } from "./telemetry";
import { RetainedCrmWork, type CrmTask } from "./coordination";

type Adapter = Pick<
  ReturnType<typeof createBrevoAdapter>,
  "getCompany" | "recoverCompany" | "createCompany" | "updateCompany"
>;
type Failure = Extract<Awaited<ReturnType<Adapter["getCompany"]>>, { ok: false }>;
const deferred = (result: Failure) =>
  ["paused", "disabled", "rate_limited", "cancelled"].includes(result.kind);

/** Reconcile one organization under the endpoint locks installed by the task list. */
export function createOrganizationSyncTask(options: {
  reader: Pick<ReturnType<typeof createCrmSnapshotReader>, "organization">;
  store: ReturnType<typeof createCrmProjectionStore>;
  adapter: Adapter;
  diagnostic?: SyncDiagnostic;
  cleanup: DeletionCleanup;
}): CrmTask<OrganizationSyncPayload> {
  const { reader, store, adapter, diagnostic = syncDiagnostic } = options;
  return async (payload, helpers) => {
    // Ephemeral diagnostics only. Provider policy always uses the loaded projection row.
    const diagnosticState: { retryFailures?: number } = {};
    try {
      const readCurrentProjection = async () => {
        diagnosticState.retryFailures = undefined;
        const current = await store.desire(await reader.organization(payload.organizationId));
        diagnosticState.retryFailures = current.retryFailures;
        return current;
      };
      let saved = await readCurrentProjection();
      if (payload.eventType === "crm.reconciliation.requested" && payload.verifyRemoteRevision) {
        diagnosticState.retryFailures = undefined;
        saved =
          (await store.verifyRemote(saved, payload.verifyRemoteRevision, payload.eventId)) ?? saved;
        diagnosticState.retryFailures = saved.retryFailures;
      }
      if (payload.eventType === "crm.recovery.requested" && payload.recoverExhaustedRevision) {
        diagnosticState.retryFailures = undefined;
        saved = (await store.recoverExhausted(saved, payload.recoverExhaustedRevision)) ?? saved;
        diagnosticState.retryFailures = saved.retryFailures;
      }
      const revision = saved.desiredRevision;
      const key = { kind: saved.kind, sourceId: saved.sourceId };
      const report = (outcome: Parameters<SyncDiagnostic>[0]) =>
        diagnostic(outcome, payload, String(helpers.job.id), diagnosticState.retryFailures);
      const failures = saved.retryFailures;
      let reserved = false;
      const defer = async (at: Date, outcome: "deferred" | "retry" = "deferred") => {
        if (reserved && outcome === "deferred") {
          diagnosticState.retryFailures = undefined;
          const refunded = await store.setRetryFailures(key, revision, failures + 1, failures);
          if (refunded) diagnosticState.retryFailures = failures;
        }
        await helpers.addJob(ORGANIZATION_SYNC_TASK, payload, {
          ...relatedSyncSpec(payload.organizationId),
          runAt: at,
        });
        report(outcome);
      };
      const block = async (code: string) => {
        if (code === "mapped_company_missing")
          reconciliationDiagnostic("missing", { kind: saved.kind });
        await store.markFailed(key, saved.desiredRevision, code, true);
        report("blocked");
        throw new RetainedCrmWork("CRM synchronization requires inspection.");
      };
      if (saved.desired.deleted || saved.deletedAt)
        return await options.cleanup(saved, payload, helpers, diagnosticState);
      if (saved.syncedRevision === saved.desiredRevision) {
        await enqueueMembershipSyncs(store, saved.desired, helpers, payload);
        report("synced");
        return;
      }
      if (saved.outcome === "blocked")
        return await block(saved.lastErrorCode ?? "projection_blocked");
      if (failures >= USER_SYNC_RETRIES) {
        await store.markFailed(key, saved.desiredRevision, "retry_budget_exhausted");
        report("exhausted");
        throw new RetainedCrmWork("CRM retry allowance exhausted.");
      }
      const handleFailure = async (result: Failure) => {
        if (result.remoteId) await store.bindRemote(key, { remoteId: result.remoteId });
        saved = await readCurrentProjection();
        if (saved.desired.deleted || saved.deletedAt || saved.desiredRevision !== revision)
          return await defer(new Date(Date.now() + 1000));
        if (deferred(result)) {
          await defer(
            new Date(Math.max(Date.now() + 1000, result.retryAt?.getTime() ?? Date.now() + 60_000)),
          );
          return;
        }
        if (result.code === "mapped_company_missing")
          reconciliationDiagnostic("missing", { kind: saved.kind });
        const retryable = result.kind === "transient" || result.kind === "ambiguous_create";
        await store.markFailed(key, saved.desiredRevision, result.code, !retryable);
        if (!retryable) {
          report("blocked");
          throw new RetainedCrmWork("CRM synchronization blocked.");
        }
        await defer(
          new Date(
            Math.max(
              Date.now() + Math.min(3600_000, 1000 * 2 ** (failures + 1)),
              result.retryAt?.getTime() ?? 0,
            ),
          ),
          "retry",
        );
      };
      const completeIfCurrent = async () => {
        saved = await readCurrentProjection();
        if (saved.desired.deleted || saved.deletedAt || saved.desiredRevision !== revision)
          return await defer(new Date(Date.now() + 1000));
        diagnosticState.retryFailures = undefined;
        const synced = await store.markSynced(
          key,
          saved.desiredRevision,
          payload.eventType === "crm.reconciliation.requested" ? payload.eventId : undefined,
        );
        if (synced) diagnosticState.retryFailures = 0;
        await enqueueMembershipSyncs(store, saved.desired, helpers, payload);
        report("synced");
      };
      const snapshot = saved.desired;
      if (snapshot.kind !== "organization" || snapshot.deleted) return;
      diagnosticState.retryFailures = undefined;
      reserved = await store.setRetryFailures(
        key,
        saved.desiredRevision,
        saved.retryFailures,
        failures + 1,
      );
      if (!reserved) return await defer(new Date(Date.now() + 1000));
      diagnosticState.retryFailures = failures + 1;
      if (!saved.remoteId) {
        if (saved.companyCreateAttemptedAt) {
          const found = await adapter.recoverCompany(snapshot.externalId, helpers.abortSignal);
          if (!found.ok) return await handleFailure(found);
          // Recover an old accepted POST even if authoritative desired state advanced.
          await store.bindRemote(key, { remoteId: found.value.id });
          await store.companyRead(payload.organizationId, found.value);
          saved = await readCurrentProjection();
          return await defer(new Date(Date.now() + 1000));
        }
        saved = await readCurrentProjection();
        if (saved.desired.deleted || saved.deletedAt || saved.desiredRevision !== revision)
          return await defer(new Date(Date.now() + 1000));
        if (!(await store.companyCreateIntent(payload.organizationId, saved.desiredRevision)))
          return await defer(new Date(Date.now() + 1000));
        const result = await adapter.createCompany(snapshot, helpers.abortSignal);
        if (result.ok) await store.bindRemote(key, { remoteId: result.value.id });
        else {
          // Adapter only classifies cancellation as such before a POST was sent.
          // A sent/unknown create is ambiguous and NEVER authorizes a second POST.
          if (deferred(result)) await store.refundCompanyCreateIntent(payload.organizationId);
          return await handleFailure(result);
        }
        return await completeIfCurrent();
      }
      let current = saved.companyRead;
      if (!current) {
        const result = await adapter.getCompany(saved.remoteId, helpers.abortSignal);
        if (!result.ok)
          return await handleFailure(
            result.kind === "not_found"
              ? { ...result, kind: "permanent", code: "mapped_company_missing" }
              : result,
          );
        current = result.value;
        if (
          current.id !== saved.remoteId ||
          current.attributes.everr_org_id !== snapshot.externalId
        )
          return await block("remote_identity_conflict");
        await store.companyRead(payload.organizationId, current);
      }
      saved = await readCurrentProjection();
      if (saved.desired.deleted || saved.deletedAt || saved.desiredRevision !== revision)
        return await defer(new Date(Date.now() + 1000));
      if (current.id !== saved.remoteId || current.attributes.everr_org_id !== snapshot.externalId)
        return await block("remote_identity_conflict");
      const result = await adapter.updateCompany(snapshot, current, helpers.abortSignal);
      if (!result.ok) return await handleFailure(result);
      if (result.changed) reconciliationDiagnostic("drift", { kind: "organization" });
      await store.companyRead(payload.organizationId, null);
      return await completeIfCurrent();
    } catch (error) {
      if (error instanceof RetainedCrmWork) throw error;
      diagnostic(
        helpers.job.attempts >= helpers.job.max_attempts ? "exhausted" : "retry",
        payload,
        String(helpers.job.id),
        diagnosticState.retryFailures,
      );
      // eslint-disable-next-line preserve-caught-error -- Raw DB/provider errors may contain profile data.
      throw new Error("CRM task failed; persisted work remains available for retry.");
    }
  };
}
