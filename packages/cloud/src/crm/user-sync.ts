import type { JobHelpers, Task } from "graphile-worker";
import type { DeletionCleanup } from "./deletion";
import type { createBrevoAdapter } from "./brevo/adapter";
import {
  USER_SYNC_RETRIES,
  USER_SYNC_TASK,
  userSyncPayload,
  userSyncSpec,
  type UserSyncPayload,
} from "./jobs";
import type { createCrmSnapshotReader, DesiredProjection } from "./snapshots";
import { snapshotFingerprint, type createCrmProjectionStore } from "./store";
import { reconciliationDiagnostic, syncDiagnostic, type SyncDiagnostic } from "./telemetry";

export class RetainedCrmWork extends Error {}

/** Only run through the partitioned Graphile task: no process-local lock or source TX over HTTP. */
export function createUserSyncTask(options: {
  reader: Pick<ReturnType<typeof createCrmSnapshotReader>, "user">;
  store: ReturnType<typeof createCrmProjectionStore>;
  adapter: Pick<
    ReturnType<typeof createBrevoAdapter>,
    "getContact" | "createContact" | "updateContact"
  >;
  reconcileMemberships?: (
    snapshot: DesiredProjection,
    helpers: JobHelpers,
    payload: UserSyncPayload,
  ) => Promise<void>;
  diagnostic?: SyncDiagnostic;
  cleanup?: DeletionCleanup;
}): Task {
  const { reader, store, adapter, diagnostic = syncDiagnostic } = options;
  const execute: Task = async (raw, helpers) => {
    const parsed = userSyncPayload.safeParse(raw);
    if (!parsed.success) {
      diagnostic("invalid", undefined, String(helpers.job.id));
      throw new RetainedCrmWork("Invalid CRM user task payload.");
    }
    const payload = parsed.data;
    const key = { kind: "user" as const, sourceId: payload.userId };
    const report = (outcome: Parameters<SyncDiagnostic>[0]) =>
      diagnostic(outcome, payload, String(helpers.job.id));
    let saved = await store.desire(await reader.user(payload.userId));
    if (payload.eventType === "crm.reconciliation.requested" && payload.verifyRemoteRevision)
      saved =
        (await store.verifyRemote(key, payload.verifyRemoteRevision, payload.eventId)) ?? saved;
    if (payload.eventType === "crm.recovery.requested" && payload.recoverExhaustedRevision)
      saved = (await store.recoverExhausted(key, payload.recoverExhaustedRevision)) ?? saved;
    const attemptRevision = saved.desiredRevision;
    // Continuations describe one desired revision. An old exhausted command must
    // not consume the fresh allowance created by a newer authoritative snapshot.
    const failures = Math.max(
      saved.retryFailures,
      payload.desiredRevision === saved.desiredRevision ? payload.failures : 0,
    );
    const defer = async (at: Date, nextFailures = failures) => {
      // Persist the successor before acknowledging this job. A crash may duplicate work,
      // but cannot erase its durable retry budget. Coalesced jobs reread current state.
      await helpers.addJob(
        USER_SYNC_TASK,
        {
          ...payload,
          failures: saved.desiredRevision === attemptRevision ? nextFailures : saved.retryFailures,
          desiredRevision: saved.desiredRevision,
        },
        {
          ...userSyncSpec(payload.userId),
          runAt: at,
        },
      );
      report(nextFailures === failures ? "deferred" : "retry");
    };
    if (saved.desired.deleted || saved.deletedAt) {
      if (options.cleanup) return options.cleanup(saved, raw, helpers);
      await store.markFailed(key, saved.desiredRevision, "deletion_cleanup_required", true);
      report("blocked");
      throw new RetainedCrmWork("CRM deletion cleanup is not configured.");
    }
    if (saved.syncedRevision === saved.desiredRevision) {
      await options.reconcileMemberships?.(saved.desired, helpers, payload);
      report("synced");
      return;
    }
    if (saved.outcome === "blocked" || failures >= USER_SYNC_RETRIES) {
      if (failures >= USER_SYNC_RETRIES) {
        await store.setRetryFailures(key, saved.desiredRevision, saved.retryFailures, failures);
        await store.markFailed(key, saved.desiredRevision, "retry_budget_exhausted");
      }
      report(saved.outcome === "blocked" ? "blocked" : "exhausted");
      throw new RetainedCrmWork("CRM synchronization requires inspection.");
    }
    const snapshot = saved.desired;
    if (snapshot.kind !== "user") throw new Error("Invalid CRM projection kind.");
    // Reserve durably before HTTP. Unknown execution after a crash conservatively
    // spends this allowance, even if the provider never received a request.
    if (
      !(await store.setRetryFailures(key, saved.desiredRevision, saved.retryFailures, failures + 1))
    ) {
      await defer(new Date(Date.now() + 1000));
      return;
    }
    const handleFailure = async (
      result: Exclude<Awaited<ReturnType<typeof adapter.getContact>>, { ok: true }>,
    ) => {
      if (result.remoteId) await store.bindRemote(key, { remoteId: result.remoteId });
      saved = await store.desire(await reader.user(payload.userId));
      if (saved.desired.deleted || saved.deletedAt) {
        if (options.cleanup) return defer(new Date(Date.now() + 1000));
        await store.markFailed(key, saved.desiredRevision, "deletion_cleanup_required", true);
        report("blocked");
        throw new RetainedCrmWork("CRM deletion cleanup is not configured.");
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
        await store.setRetryFailures(key, saved.desiredRevision, failures + 1, failures);
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
        failures + 1,
      );
    };
    const current = await adapter.getContact(snapshot.externalId, helpers.abortSignal);
    if (!current.ok && current.kind !== "not_found") {
      await handleFailure(current);
      return;
    }
    // A source may change while lookup is in flight. Never initiate a write for that snapshot.
    const beforeWrite = await store.desire(await reader.user(payload.userId));
    if (
      beforeWrite.desired.deleted ||
      beforeWrite.deletedAt ||
      beforeWrite.desiredRevision !== saved.desiredRevision
    ) {
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
    const latest = await reader.user(payload.userId);
    const unchanged = snapshotFingerprint(latest) === saved.desiredFingerprint;
    saved = await store.desire(latest);
    if (saved.desired.deleted || saved.deletedAt) {
      if (options.cleanup) return defer(new Date(Date.now() + 1000));
      await store.markFailed(key, saved.desiredRevision, "deletion_cleanup_required", true);
      report("blocked");
      throw new RetainedCrmWork("CRM deletion cleanup is not configured.");
    }
    if (!unchanged) {
      await defer(new Date(Date.now() + 1000));
      return;
    }
    await store.markSynced(
      key,
      saved.desiredRevision,
      payload.eventType === "crm.reconciliation.requested" ? payload.eventId : undefined,
    );
    await options.reconcileMemberships?.(saved.desired, helpers, payload);
    report("synced");
  };
  return async (raw, helpers) => {
    try {
      await execute(raw, helpers);
    } catch (error) {
      if (error instanceof RetainedCrmWork) throw error;
      // Source/database errors can embed SQL parameters. Never give them to Graphile's logger.
      const parsed = userSyncPayload.safeParse(raw);
      diagnostic(
        helpers.job.attempts >= helpers.job.max_attempts ? "exhausted" : "retry",
        parsed.success ? parsed.data : undefined,
        String(helpers.job.id),
      );
      // An infrastructure failure is retried by Graphile without changing this payload.
      // eslint-disable-next-line preserve-caught-error -- Drizzle causes may contain contact payloads.
      throw new Error("CRM task failed; persisted work remains available for retry.");
    }
  };
}
