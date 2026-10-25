import { enqueueMembershipSyncs } from "./membership-jobs";
import type { DeletionCleanup } from "./deletion";
import type { createBrevoAdapter } from "./brevo/adapter";
import { USER_SYNC_RETRIES, USER_SYNC_TASK, userSyncSpec, type UserSyncPayload } from "./commands";
import type { createCrmSnapshotReader } from "./snapshots";
import type { createCrmProjectionStore } from "./store";
import { reconciliationDiagnostic, syncDiagnostic, type SyncDiagnostic } from "./telemetry";
import { RetainedCrmWork, type CrmTask } from "./coordination";

/** Only run through the partitioned Graphile task: no process-local lock or source TX over HTTP. */
export function createUserSyncTask(options: {
  reader: Pick<ReturnType<typeof createCrmSnapshotReader>, "user">;
  store: ReturnType<typeof createCrmProjectionStore>;
  adapter: Pick<
    ReturnType<typeof createBrevoAdapter>,
    "getContact" | "createContact" | "updateContact"
  >;
  diagnostic?: SyncDiagnostic;
  cleanup: DeletionCleanup;
}): CrmTask<UserSyncPayload> {
  const { reader, store, adapter, diagnostic = syncDiagnostic } = options;
  return async (payload, helpers) => {
    // Ephemeral diagnostics only. Provider policy always uses the loaded projection row.
    const diagnosticState: { retryFailures?: number } = {};
    try {
      const readCurrentProjection = async () => {
        diagnosticState.retryFailures = undefined;
        const current = await store.desire(await reader.user(payload.userId));
        diagnosticState.retryFailures = current.retryFailures;
        return current;
      };
      const key = { kind: "user" as const, sourceId: payload.userId };
      const report = (outcome: Parameters<SyncDiagnostic>[0]) =>
        diagnostic(outcome, payload, String(helpers.job.id), diagnosticState.retryFailures);
      let saved = await readCurrentProjection();
      if (payload.eventType === "crm.reconciliation.requested" && payload.verifyRemoteRevision) {
        diagnosticState.retryFailures = undefined;
        saved =
          (await store.verifyRemote(key, payload.verifyRemoteRevision, payload.eventId)) ?? saved;
        diagnosticState.retryFailures = saved.retryFailures;
      }
      if (payload.eventType === "crm.recovery.requested" && payload.recoverExhaustedRevision) {
        diagnosticState.retryFailures = undefined;
        saved = (await store.recoverExhausted(key, payload.recoverExhaustedRevision)) ?? saved;
        diagnosticState.retryFailures = saved.retryFailures;
      }
      const attemptRevision = saved.desiredRevision;
      const failures = saved.retryFailures;
      const defer = async (at: Date, outcome: "deferred" | "retry" = "deferred") => {
        // Persist the successor before acknowledging this job. A crash may duplicate work,
        // but cannot erase its durable retry budget. Coalesced jobs reread current state.
        await helpers.addJob(USER_SYNC_TASK, payload, {
          ...userSyncSpec(payload.userId),
          runAt: at,
        });
        report(outcome);
      };
      if (saved.desired.deleted || saved.deletedAt) {
        return await options.cleanup(saved, payload, helpers, diagnosticState);
      }
      if (saved.syncedRevision === saved.desiredRevision) {
        await enqueueMembershipSyncs(store, saved.desired, helpers, payload);
        report("synced");
        return;
      }
      if (saved.outcome === "blocked" || failures >= USER_SYNC_RETRIES) {
        if (failures >= USER_SYNC_RETRIES) {
          await store.markFailed(key, saved.desiredRevision, "retry_budget_exhausted");
        }
        report(saved.outcome === "blocked" ? "blocked" : "exhausted");
        throw new RetainedCrmWork("CRM synchronization requires inspection.");
      }
      const snapshot = saved.desired;
      if (snapshot.kind !== "user") throw new Error("Invalid CRM projection kind.");
      // Reserve durably before HTTP. Unknown execution after a crash conservatively
      // spends this allowance, even if the provider never received a request.
      diagnosticState.retryFailures = undefined;
      if (
        !(await store.setRetryFailures(
          key,
          saved.desiredRevision,
          saved.retryFailures,
          failures + 1,
        ))
      ) {
        await defer(new Date(Date.now() + 1000));
        return;
      }
      saved = { ...saved, retryFailures: failures + 1 };
      diagnosticState.retryFailures = saved.retryFailures;
      const handleFailure = async (
        result: Exclude<Awaited<ReturnType<typeof adapter.getContact>>, { ok: true }>,
      ) => {
        if (result.remoteId) await store.bindRemote(key, { remoteId: result.remoteId });
        saved = await readCurrentProjection();
        if (saved.desired.deleted || saved.deletedAt) {
          return await defer(new Date(Date.now() + 1000));
        }
        if (saved.desiredRevision !== attemptRevision) {
          await defer(new Date(Date.now() + 1000));
          return;
        }
        if (
          result.kind === "paused" ||
          result.kind === "disabled" ||
          result.kind === "rate_limited" ||
          result.kind === "cancelled"
        ) {
          diagnosticState.retryFailures = undefined;
          const refunded = await store.setRetryFailures(
            key,
            attemptRevision,
            failures + 1,
            failures,
          );
          if (refunded) {
            saved = { ...saved, retryFailures: failures };
            diagnosticState.retryFailures = saved.retryFailures;
          }
          await defer(
            new Date(Math.max(Date.now() + 1000, result.retryAt?.getTime() ?? Date.now() + 60_000)),
          );
          return;
        }
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
      const current = await adapter.getContact(snapshot.externalId, helpers.abortSignal);
      if (!current.ok && current.kind !== "not_found") {
        await handleFailure(current);
        return;
      }
      // A source may change while lookup is in flight. Never initiate a write for that snapshot.
      const beforeWrite = await readCurrentProjection();
      if (
        beforeWrite.desired.deleted ||
        beforeWrite.deletedAt ||
        beforeWrite.desiredRevision !== saved.desiredRevision
      ) {
        saved = beforeWrite;
        await defer(new Date(Date.now() + 1000));
        return;
      }
      if (!current.ok && saved.remoteId) {
        reconciliationDiagnostic("missing", { kind: "user" });
        await store.markFailed(key, saved.desiredRevision, "mapped_contact_missing", true);
        report("blocked");
        throw new RetainedCrmWork("Mapped CRM contact missing.");
      }
      if (current.ok && saved.remoteId && saved.remoteId !== String(current.value.id)) {
        await store.markFailed(key, saved.desiredRevision, "remote_identity_conflict", true);
        report("blocked");
        throw new RetainedCrmWork("CRM remote identity conflict.");
      }
      if (current.ok) await store.bindRemote(key, { remoteId: String(current.value.id) });
      const result = current.ok
        ? await adapter.updateContact(snapshot, current.value, helpers.abortSignal)
        : await adapter.createContact(snapshot, helpers.abortSignal);
      if (result.ok && ("changed" in result ? result.changed : !current.ok))
        reconciliationDiagnostic("drift", { kind: "user" });
      if (result.ok && result.value)
        await store.bindRemote(key, { remoteId: String(result.value.id) });
      if (!result.ok) {
        await handleFailure(result);
        return;
      }
      // HTTP cannot be atomic with deletion. Capture a terminal tombstone and retain the
      // mapping for deletion cleanup; never acknowledge stale success or recreate the source.
      saved = await readCurrentProjection();
      if (saved.desired.deleted || saved.deletedAt || saved.desiredRevision !== attemptRevision) {
        return await defer(new Date(Date.now() + 1000));
      }
      diagnosticState.retryFailures = undefined;
      const synced = await store.markSynced(
        key,
        saved.desiredRevision,
        payload.eventType === "crm.reconciliation.requested" ? payload.eventId : undefined,
      );
      if (synced) {
        saved = { ...saved, retryFailures: 0 };
        diagnosticState.retryFailures = saved.retryFailures;
      }
      await enqueueMembershipSyncs(store, saved.desired, helpers, payload);
      report("synced");
    } catch (error) {
      if (error instanceof RetainedCrmWork) throw error;
      // Source/database errors can embed SQL parameters. Never give them to Graphile's logger.
      diagnostic(
        helpers.job.attempts >= helpers.job.max_attempts ? "exhausted" : "retry",
        payload,
        String(helpers.job.id),
        diagnosticState.retryFailures,
      );
      // An infrastructure failure is retried by Graphile without changing this payload.
      // eslint-disable-next-line preserve-caught-error -- Drizzle causes may contain contact payloads.
      throw new Error("CRM task failed; persisted work remains available for retry.");
    }
  };
}
