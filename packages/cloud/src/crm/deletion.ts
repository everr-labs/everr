import { enqueueMembershipSyncs } from "./membership-jobs";
import type { JobHelpers } from "graphile-worker";
import type { createBrevoAdapter } from "./brevo/adapter";
import {
  ORGANIZATION_SYNC_TASK,
  USER_SYNC_TASK,
  USER_SYNC_RETRIES,
  type OrganizationSyncPayload,
  type UserSyncPayload,
  relatedSyncSpec,
  userSyncSpec,
} from "./commands";
import type { createCrmProjectionStore } from "./store";
import { syncDiagnostic, type SyncDiagnostic } from "./telemetry";
import { RetainedCrmWork } from "./coordination";

type Store = ReturnType<typeof createCrmProjectionStore>;
type Saved = NonNullable<Awaited<ReturnType<Store["read"]>>>;
type Adapter = Pick<
  ReturnType<typeof createBrevoAdapter>,
  "getContact" | "deleteContact" | "getCompany" | "recoverCompany" | "deleteCompany"
>;

/** Called only under the normal parent endpoint lock. Source identities are terminal.
 * No source transaction spans HTTP. Keep remote IDs and tombstones after success.
 */
export function createDeletionCleanup(options: {
  store: Store;
  adapter: Adapter;
  diagnostic?: SyncDiagnostic;
}) {
  const { store, adapter, diagnostic = syncDiagnostic } = options;
  return async (
    saved: Saved,
    payload: UserSyncPayload | OrganizationSyncPayload,
    helpers: JobHelpers,
    diagnosticState: { retryFailures?: number } = {},
  ) => {
    const observe = () => {
      diagnosticState.retryFailures = saved.retryFailures;
    };
    observe();
    if (saved.kind === "membership" || !saved.desired.deleted || !saved.deletedAt)
      throw new Error("CRM cleanup requires a retained entity tombstone.");
    const matches =
      saved.kind === "user"
        ? !("kind" in payload) && payload.userId === saved.sourceId
        : "kind" in payload &&
          payload.kind === "organization" &&
          payload.organizationId === saved.sourceId;
    if (!matches) throw new Error("CRM cleanup command does not match retained identity.");
    const key = { kind: saved.kind, sourceId: saved.sourceId };
    if (
      (payload.eventType === "crm.reconciliation.requested" ||
        payload.eventType === "crm.bootstrap.requested") &&
      payload.recheckDeletionRevision === saved.desiredRevision &&
      saved.syncedRevision === saved.desiredRevision
    ) {
      diagnosticState.retryFailures = undefined;
      saved = (await store.recheckDeletion(key, saved.desiredRevision)) ?? saved;
    }
    observe();
    const report = (outcome: Parameters<SyncDiagnostic>[0]) => {
      diagnostic(outcome, payload, String(helpers.job.id), diagnosticState.retryFailures);
    };
    const failures = saved.retryFailures;
    let reserved = false;
    const defer = async (at: Date, outcome: "deferred" | "retry" = "deferred") => {
      if (reserved && outcome === "deferred") {
        diagnosticState.retryFailures = undefined;
        const refunded = await store.setRetryFailures(
          key,
          saved.desiredRevision,
          failures + 1,
          failures,
        );
        if (refunded) {
          saved = { ...saved, retryFailures: failures };
          observe();
        }
      }
      await helpers.addJob(
        saved.kind === "user" ? USER_SYNC_TASK : ORGANIZATION_SYNC_TASK,
        payload,
        {
          ...(saved.kind === "user"
            ? userSyncSpec(saved.sourceId)
            : relatedSyncSpec(saved.sourceId)),
          runAt: at,
        },
      );
      report(outcome);
    };
    const block = async (code: string) => {
      await store.markFailed(key, saved.desiredRevision, code, true);
      report("blocked");
      throw new RetainedCrmWork("CRM deletion cleanup requires inspection.");
    };
    const complete = async () => {
      await store.cleanupCompanyRead(key, null);
      diagnosticState.retryFailures = undefined;
      const synced = await store.markSynced(
        key,
        saved.desiredRevision,
        payload.eventType === "crm.reconciliation.requested" ? payload.eventId : undefined,
      );
      if (synced) {
        saved = { ...saved, retryFailures: 0 };
        observe();
      }
      await enqueueMembershipSyncs(store, saved.desired, helpers, payload);
      report("synced");
    };
    if (saved.syncedRevision === saved.desiredRevision) {
      await enqueueMembershipSyncs(store, saved.desired, helpers, payload);
      report("synced");
      return;
    }
    if (saved.outcome === "blocked") return block(saved.lastErrorCode ?? "projection_blocked");
    if (failures >= USER_SYNC_RETRIES) {
      await store.markFailed(key, saved.desiredRevision, "retry_budget_exhausted");
      report("exhausted");
      throw new RetainedCrmWork("CRM deletion retry allowance exhausted.");
    }
    diagnosticState.retryFailures = undefined;
    reserved = await store.setRetryFailures(
      key,
      saved.desiredRevision,
      saved.retryFailures,
      failures + 1,
    );
    if (!reserved) return defer(new Date(Date.now() + 1000));
    saved = { ...saved, retryFailures: failures + 1 };
    observe();
    const failure = async (
      result: Extract<Awaited<ReturnType<Adapter["getCompany"]>>, { ok: false }>,
    ) => {
      if (["paused", "disabled", "rate_limited", "cancelled"].includes(result.kind))
        return defer(
          new Date(Math.max(Date.now() + 1000, result.retryAt?.getTime() ?? Date.now() + 60_000)),
        );
      const retryable = result.kind === "transient" || result.kind === "ambiguous_create";
      if (!retryable) return block(result.code);
      await store.markFailed(key, saved.desiredRevision, result.code);
      return defer(
        new Date(
          Math.max(
            Date.now() + Math.min(3600_000, 1000 * 2 ** (failures + 1)),
            result.retryAt?.getTime() ?? 0,
          ),
        ),
        "retry",
      );
    };
    if (saved.kind === "user") {
      // External identity recovers accepted creates whose local binding was lost.
      // Never look up by email, and never delete an ID belonging to another identity.
      const current = await adapter.getContact(saved.externalId, helpers.abortSignal);
      if (!current.ok) return current.kind === "not_found" ? complete() : failure(current);
      if (
        current.value.attributes.EXT_ID !== saved.externalId ||
        (saved.remoteId && saved.remoteId !== String(current.value.id))
      )
        return block("remote_identity_conflict");
      await store.bindRemote(key, { remoteId: String(current.value.id) });
      const result = await adapter.deleteContact(current.value.id, helpers.abortSignal);
      if (!result.ok && result.kind !== "not_found") return failure(result);
      return complete();
    }
    if (saved.kind !== "organization") return block("invalid_projection_kind");
    if (!saved.remoteId && !saved.companyCreateAttemptedAt) return complete();
    let current = saved.cleanupCompanyRead;
    if (!current) {
      const result = saved.remoteId
        ? await adapter.getCompany(saved.remoteId, helpers.abortSignal)
        : await adapter.recoverCompany(saved.externalId, helpers.abortSignal);
      if (!result.ok)
        return saved.remoteId && result.kind === "not_found" ? complete() : failure(result);
      current = result.value;
      if (
        current.attributes.everr_org_id !== saved.externalId ||
        (saved.remoteId && saved.remoteId !== current.id)
      )
        return block("remote_identity_conflict");
      await store.bindRemote(key, { remoteId: current.id });
      // Durable read lets DELETE resume at the next 36-second general permit.
      await store.cleanupCompanyRead(key, current);
    }
    if (
      current.attributes.everr_org_id !== saved.externalId ||
      (saved.remoteId && saved.remoteId !== current.id)
    )
      return block("remote_identity_conflict");
    const result = await adapter.deleteCompany(current.id, helpers.abortSignal);
    if (!result.ok && result.kind !== "not_found") return failure(result);
    return complete();
  };
}

export type DeletionCleanup = ReturnType<typeof createDeletionCleanup>;
