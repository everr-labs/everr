import type { createBrevoAdapter } from "./brevo/adapter";
import {
  MEMBERSHIP_SYNC_TASK,
  ORGANIZATION_SYNC_TASK,
  USER_SYNC_TASK,
  USER_SYNC_RETRIES,
  relatedSyncSpec,
  userSyncSpec,
  type MembershipSyncPayload,
} from "./commands";
import { projectionIdentity, type createCrmSnapshotReader } from "./snapshots";
import type { createCrmProjectionStore } from "./store";
import { reconciliationDiagnostic, syncDiagnostic, type SyncDiagnostic } from "./telemetry";
import { RetainedCrmWork, type CrmTask } from "./coordination";

type Adapter = Pick<
  ReturnType<typeof createBrevoAdapter>,
  "getCompany" | "getContact" | "associate"
>;
type Failure = Extract<Awaited<ReturnType<Adapter["getCompany"]>>, { ok: false }>;
const deferred = (result: Failure) =>
  ["paused", "disabled", "rate_limited", "cancelled"].includes(result.kind);

/** Reconcile one membership under the endpoint locks installed by the task list. */
export function createMembershipSyncTask(options: {
  reader: ReturnType<typeof createCrmSnapshotReader>;
  store: ReturnType<typeof createCrmProjectionStore>;
  adapter: Adapter;
  diagnostic?: SyncDiagnostic;
  deployment: string;
}): CrmTask<MembershipSyncPayload> {
  const { reader, store, adapter, diagnostic = syncDiagnostic } = options;
  return async (payload, helpers) => {
    // Ephemeral diagnostics only. Provider policy always uses the loaded projection row.
    let retryFailures: number | undefined;
    try {
      const readCurrentProjection = async () => {
        retryFailures = undefined;
        const current = await store.desire(
          await reader.membership(payload.userId, payload.organizationId),
        );
        retryFailures = current.retryFailures;
        return current;
      };
      let saved = await readCurrentProjection();
      if (
        saved.desired.deleted &&
        (payload.eventType === "crm.reconciliation.requested" ||
          payload.eventType === "crm.bootstrap.requested") &&
        payload.recheckDeletionRevision === saved.desiredRevision &&
        saved.syncedRevision === saved.desiredRevision
      ) {
        retryFailures = undefined;
        saved = (await store.recheckDeletion(saved, saved.desiredRevision)) ?? saved;
        retryFailures = saved.retryFailures;
      }
      if (payload.eventType === "crm.reconciliation.requested" && payload.verifyRemoteRevision) {
        retryFailures = undefined;
        saved =
          (await store.verifyRemote(saved, payload.verifyRemoteRevision, payload.eventId)) ?? saved;
        retryFailures = saved.retryFailures;
      }
      if (payload.eventType === "crm.recovery.requested" && payload.recoverExhaustedRevision) {
        retryFailures = undefined;
        saved = (await store.recoverExhausted(saved, payload.recoverExhaustedRevision)) ?? saved;
        retryFailures = saved.retryFailures;
      }
      const revision = saved.desiredRevision;
      const key = { kind: saved.kind, sourceId: saved.sourceId };
      const report = (outcome: Parameters<SyncDiagnostic>[0]) =>
        diagnostic(outcome, payload, String(helpers.job.id), retryFailures);
      const failures = saved.retryFailures;
      let reserved = false;
      const defer = async (at: Date, outcome: "deferred" | "retry" = "deferred") => {
        if (reserved && outcome === "deferred") {
          retryFailures = undefined;
          const refunded = await store.setRetryFailures(key, revision, failures + 1, failures);
          if (refunded) retryFailures = failures;
        }
        await helpers.addJob(MEMBERSHIP_SYNC_TASK, payload, {
          ...relatedSyncSpec(payload.organizationId, payload.userId),
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
      if (saved.syncedRevision === saved.desiredRevision) {
        report("synced");
        return;
      }
      // Dependency failures describe the parents, not this pair's remote identity.
      // Reassess them under both endpoint locks after parent recovery, retaining
      // the pair's existing revision and retry allowance. Its own blocks remain terminal.
      const reassessParents = saved.lastErrorCode === "prerequisite_blocked";
      if (saved.outcome === "blocked" && !reassessParents)
        return await block(saved.lastErrorCode ?? "projection_blocked");
      if (failures >= USER_SYNC_RETRIES) {
        await store.markFailed(key, saved.desiredRevision, "retry_budget_exhausted");
        report("exhausted");
        throw new RetainedCrmWork("CRM retry allowance exhausted.");
      }
      const handleFailure = async (result: Failure) => {
        saved = await readCurrentProjection();
        if (saved.desiredRevision !== revision) return await defer(new Date(Date.now() + 1000));
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
        if (saved.desiredRevision !== revision) return await defer(new Date(Date.now() + 1000));
        retryFailures = undefined;
        const synced = await store.markSynced(
          key,
          saved.desiredRevision,
          payload.eventType === "crm.reconciliation.requested" ? payload.eventId : undefined,
        );
        if (synced) retryFailures = 0;
        report("synced");
      };
      const linked = !saved.desired.deleted;
      if (linked) {
        // Locks for both endpoints also cover User and Organization parent jobs.
        const contact = await store.desire(await reader.user(payload.userId));
        const company = await store.desire(await reader.organization(payload.organizationId));
        if (
          contact.desired.deleted ||
          contact.deletedAt ||
          company.desired.deleted ||
          company.deletedAt
        ) {
          saved = await readCurrentProjection();
          if (saved.desiredRevision !== revision) return await defer(new Date(Date.now() + 1000));
          return await block("parent_deletion_cleanup_required");
        }
        if (
          [contact, company].some(
            (parent) => parent.outcome === "blocked" || parent.retryFailures >= USER_SYNC_RETRIES,
          )
        )
          return await block("prerequisite_blocked");
        if (!contact.remoteId || !company.remoteId) {
          const origin = {
            version: 1,
            eventId: payload.eventId,
            eventType: payload.eventType,
            occurredAt: payload.occurredAt,
          };
          if (!contact.remoteId)
            await helpers.addJob(
              USER_SYNC_TASK,
              { ...origin, userId: payload.userId },
              {
                ...userSyncSpec(payload.userId),
              },
            );
          if (!company.remoteId)
            await helpers.addJob(
              ORGANIZATION_SYNC_TASK,
              {
                ...origin,
                kind: "organization",
                organizationId: payload.organizationId,
              },
              {
                ...relatedSyncSpec(payload.organizationId),
              },
            );
          return await defer(new Date(Date.now() + 60_000));
        }
        saved = await store.bindRemote(key, {
          remoteContactId: contact.remoteId,
          remoteCompanyId: company.remoteId,
        });
        retryFailures = saved.retryFailures;
      }
      // No mapping means this pair never linked, so removing it requires no provider call.
      if (!saved.remoteContactId || !saved.remoteCompanyId) return await completeIfCurrent();
      const remoteCompanyId = saved.remoteCompanyId;
      const remoteContactId = saved.remoteContactId;
      saved = await readCurrentProjection();
      if (saved.desiredRevision !== revision) return await defer(new Date(Date.now() + 1000));
      // Refresh the source parents before a link, including terminal retained tombstones.
      if (linked) {
        const parents = await Promise.all([
          store.desire(await reader.user(payload.userId)),
          store.desire(await reader.organization(payload.organizationId)),
        ]);
        if (parents.some((parent) => parent.desired.deleted || parent.deletedAt)) {
          saved = await readCurrentProjection();
          if (saved.desiredRevision !== revision) return await defer(new Date(Date.now() + 1000));
          return await block("parent_deletion_cleanup_required");
        }
        if (
          parents.some(
            (parent) => parent.outcome === "blocked" || parent.retryFailures >= USER_SYNC_RETRIES,
          )
        )
          return await block("prerequisite_blocked");
      }
      const contactId = Number(remoteContactId);
      if (!Number.isSafeInteger(contactId) || contactId <= 0)
        return await block("invalid_contact_mapping");
      retryFailures = undefined;
      reserved = await store.setRetryFailures(
        key,
        saved.desiredRevision,
        saved.retryFailures,
        failures + 1,
      );
      if (!reserved) return await defer(new Date(Date.now() + 1000));
      retryFailures = failures + 1;
      if (!linked) {
        const contact = await adapter.getContact(
          projectionIdentity(options.deployment, { kind: "user", id: payload.userId }).externalId,
          helpers.abortSignal,
        );
        if (!contact.ok)
          return contact.kind === "not_found"
            ? await completeIfCurrent()
            : await handleFailure(contact);
        if (
          String(contact.value.id) !== remoteContactId ||
          contact.value.attributes.EXT_ID !==
            projectionIdentity(options.deployment, { kind: "user", id: payload.userId }).externalId
        )
          return await block("remote_identity_conflict");
      }
      const companyExternalId = projectionIdentity(options.deployment, {
        kind: "organization",
        id: payload.organizationId,
      }).externalId;
      let company = saved.cleanupCompanyRead;
      if (!company) {
        const result = await adapter.getCompany(remoteCompanyId, helpers.abortSignal);
        if (!result.ok) {
          if (result.kind === "not_found")
            return linked ? await block("mapped_company_missing") : await completeIfCurrent();
          return await handleFailure(result);
        }
        company = result.value;
      }
      if (company.id !== remoteCompanyId || company.attributes.everr_org_id !== companyExternalId)
        return await block("remote_identity_conflict");
      if (!saved.cleanupCompanyRead) await store.cleanupCompanyRead(key, company);
      saved = await readCurrentProjection();
      if (saved.desiredRevision !== revision) return await defer(new Date(Date.now() + 1000));
      if (linked) {
        if (company.linkedContactsIds?.includes(contactId)) return await completeIfCurrent();
      } else if (
        saved.cleanupCompanyRead?.linkedContactsIds &&
        !saved.cleanupCompanyRead.linkedContactsIds.includes(contactId)
      )
        return await completeIfCurrent();
      const result = await adapter.associate(
        remoteCompanyId,
        contactId,
        linked,
        helpers.abortSignal,
      );
      if (!result.ok && !(result.kind === "not_found" && !linked))
        return await handleFailure(result);
      if (result.ok) reconciliationDiagnostic("drift", { kind: "membership" });
      saved = await readCurrentProjection();
      if (saved.desiredRevision !== revision) return await defer(new Date(Date.now() + 1000));
      // A source pair may be removed/re-added during HTTP. The next revision corrects it.
      if (linked) {
        const parents = await Promise.all([
          store.desire(await reader.user(payload.userId)),
          store.desire(await reader.organization(payload.organizationId)),
        ]);
        if (parents.some((parent) => parent.desired.deleted || parent.deletedAt)) {
          saved = await readCurrentProjection();
          if (saved.desiredRevision !== revision) return await defer(new Date(Date.now() + 1000));
          return await block("parent_deletion_cleanup_required");
        }
        if (
          parents.some(
            (parent) => parent.outcome === "blocked" || parent.retryFailures >= USER_SYNC_RETRIES,
          )
        )
          return await block("prerequisite_blocked");
      }
      await store.cleanupCompanyRead(key, null);
      return await completeIfCurrent();
    } catch (error) {
      if (error instanceof RetainedCrmWork) throw error;
      diagnostic(
        helpers.job.attempts >= helpers.job.max_attempts ? "exhausted" : "retry",
        payload,
        String(helpers.job.id),
        retryFailures,
      );
      // eslint-disable-next-line preserve-caught-error -- Raw DB/provider errors may contain profile data.
      throw new Error("CRM task failed; persisted work remains available for retry.");
    }
  };
}
