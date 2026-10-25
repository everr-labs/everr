import type { JobHelpers } from "graphile-worker";
import type { DeletionCleanup } from "./deletion";
import type { createBrevoAdapter } from "./brevo/adapter";
import {
  MEMBERSHIP_SYNC_TASK,
  ORGANIZATION_SYNC_TASK,
  USER_SYNC_RETRIES,
  USER_SYNC_TASK,
  relatedSyncSpec,
  userSyncSpec,
  type MembershipSyncPayload,
  type OrganizationSyncPayload,
  type UserSyncPayload,
} from "./jobs";
import {
  projectionIdentity,
  type createCrmSnapshotReader,
  type DesiredProjection,
} from "./snapshots";
import type { createCrmProjectionStore } from "./store";
import { reconciliationDiagnostic, syncDiagnostic, type SyncDiagnostic } from "./telemetry";
import { RetainedCrmWork, type CrmTask } from "./coordination";

type Payload = MembershipSyncPayload | OrganizationSyncPayload;
type Store = ReturnType<typeof createCrmProjectionStore>;
type Reader = ReturnType<typeof createCrmSnapshotReader>;
type Adapter = Pick<
  ReturnType<typeof createBrevoAdapter>,
  "getCompany" | "getContact" | "recoverCompany" | "createCompany" | "updateCompany" | "associate"
>;
type Failure = Extract<Awaited<ReturnType<Adapter["getCompany"]>>, { ok: false }>;
const deferred = (result: Failure) =>
  ["paused", "disabled", "rate_limited", "cancelled"].includes(result.kind);

/** Reconcile explicit pairs, including retained mappings no longer present in source.
 * Enqueue prerequisites and continuations; never wait for another task in this runner.
 */
export function membershipFanout(store: Store) {
  return async (
    snapshot: DesiredProjection,
    helpers: JobHelpers,
    origin: UserSyncPayload | Payload,
  ) => {
    if (snapshot.kind === "membership") return;
    const prior = await store.memberships(
      snapshot.kind === "user"
        ? { userId: snapshot.sourceId }
        : { organizationId: snapshot.sourceId },
    );
    const pairs = new Map<string, { userId: string; organizationId: string }>();
    for (const pair of [...prior, ...(snapshot.deleted ? [] : snapshot.memberships)]) {
      if (!pair.userId || !pair.organizationId) continue;
      pairs.set(JSON.stringify([pair.userId, pair.organizationId]), {
        userId: pair.userId,
        organizationId: pair.organizationId,
      });
    }
    for (const pair of pairs.values()) {
      const previous = prior.find(
        (row) => row.userId === pair.userId && row.organizationId === pair.organizationId,
      );
      const recheck =
        origin.eventType === "crm.reconciliation.requested" &&
        previous &&
        previous.syncedRevision === previous.desiredRevision &&
        previous.remoteCheckId !== origin.eventId
          ? previous.desiredRevision
          : undefined;
      await helpers.addJob(
        MEMBERSHIP_SYNC_TASK,
        {
          version: 1,
          kind: "membership",
          ...pair,
          eventId: origin.eventId,
          eventType: origin.eventType,
          occurredAt: origin.occurredAt,
          ...(recheck
            ? previous?.desired.deleted
              ? { recheckDeletionRevision: recheck }
              : { verifyRemoteRevision: recheck }
            : {}),
          failures: 0,
        },
        {
          ...relatedSyncSpec(pair.organizationId, pair.userId),
        },
      );
    }
  };
}

/** Concrete company/pair execution shares durable allowance and continuation handling.
 * Company read progress and create intent live in the projection, never just the job.
 */
export function createRelatedSyncTask(options: {
  deployment: string;
  reader: Reader;
  store: Store;
  adapter: Adapter;
  diagnostic?: SyncDiagnostic;
  cleanup: DeletionCleanup;
}): CrmTask<Payload> {
  const { reader, store, adapter, diagnostic = syncDiagnostic } = options;
  const fanout = membershipFanout(store);
  const execute = async (
    payload: Payload,
    helpers: JobHelpers,
    diagnosticState: { retryFailures?: number },
  ) => {
    const identifier =
      payload.kind === "organization" ? ORGANIZATION_SYNC_TASK : MEMBERSHIP_SYNC_TASK;
    const observe = <T extends { retryFailures: number }>(row: T): T => {
      diagnosticState.retryFailures = row.retryFailures;
      return row;
    };
    const load = () =>
      payload.kind === "organization"
        ? reader.organization(payload.organizationId)
        : reader.membership(payload.userId, payload.organizationId);
    let saved = observe(await store.desire(await load()));
    if (
      saved.kind === "membership" &&
      saved.desired.deleted &&
      (payload.eventType === "crm.reconciliation.requested" ||
        payload.eventType === "crm.bootstrap.requested") &&
      payload.recheckDeletionRevision === saved.desiredRevision &&
      saved.syncedRevision === saved.desiredRevision
    ) {
      diagnosticState.retryFailures = undefined;
      saved = observe((await store.recheckDeletion(saved, saved.desiredRevision)) ?? saved);
    }
    if (payload.eventType === "crm.reconciliation.requested" && payload.verifyRemoteRevision) {
      diagnosticState.retryFailures = undefined;
      saved = observe(
        (await store.verifyRemote(saved, payload.verifyRemoteRevision, payload.eventId)) ?? saved,
      );
    }
    if (payload.eventType === "crm.recovery.requested" && payload.recoverExhaustedRevision) {
      diagnosticState.retryFailures = undefined;
      saved = observe(
        (await store.recoverExhausted(saved, payload.recoverExhaustedRevision)) ?? saved,
      );
    }
    const initial = saved;
    const key = { kind: saved.kind, sourceId: saved.sourceId };
    const report = (outcome: Parameters<SyncDiagnostic>[0]) =>
      diagnostic(outcome, payload, String(helpers.job.id), diagnosticState.retryFailures);
    const failures = saved.retryFailures;
    let reserved = false;
    const defer = async (at: Date, outcome: "deferred" | "retry" = "deferred") => {
      if (reserved && outcome === "deferred") {
        diagnosticState.retryFailures = undefined;
        const refunded = await store.setRetryFailures(
          key,
          initial.desiredRevision,
          failures + 1,
          failures,
        );
        if (refunded) saved = observe({ ...saved, retryFailures: failures });
      }
      // Retain only an inert v1 compatibility value, never a second retry budget.
      const continuation = { ...payload, failures: 0 };
      delete continuation.desiredRevision;
      await helpers.addJob(identifier, continuation, {
        ...relatedSyncSpec(
          payload.organizationId,
          payload.kind === "membership" ? payload.userId : undefined,
        ),
        runAt: at,
      });
      report(outcome);
    };
    const soon = () => defer(new Date(Date.now() + 1000));
    const block = async (code: string) => {
      if (code === "mapped_company_missing")
        reconciliationDiagnostic("missing", { kind: saved.kind });
      await store.markFailed(key, saved.desiredRevision, code, true);
      report("blocked");
      throw new RetainedCrmWork("CRM synchronization requires inspection.");
    };
    const terminal = () =>
      saved.kind !== "membership" && (saved.desired.deleted || !!saved.deletedAt);
    if (terminal() && payload.kind === "organization")
      return options.cleanup(saved, payload, helpers, diagnosticState);
    if (saved.syncedRevision === saved.desiredRevision) {
      if (payload.kind === "organization") await fanout(saved.desired, helpers, payload);
      report("synced");
      return;
    }
    // Dependency failures describe the parents, not this pair's remote identity.
    // Reassess them under both endpoint locks after parent recovery, retaining
    // the pair's existing revision and retry allowance. Its own blocks remain terminal.
    const reassessParents =
      saved.kind === "membership" && saved.lastErrorCode === "prerequisite_blocked";
    if (saved.outcome === "blocked" && !reassessParents)
      return block(saved.lastErrorCode ?? "projection_blocked");
    if (failures >= USER_SYNC_RETRIES) {
      await store.markFailed(key, saved.desiredRevision, "retry_budget_exhausted");
      report("exhausted");
      throw new RetainedCrmWork("CRM retry allowance exhausted.");
    }
    const reserve = async () => {
      diagnosticState.retryFailures = undefined;
      reserved = await store.setRetryFailures(
        key,
        saved.desiredRevision,
        saved.retryFailures,
        failures + 1,
      );
      if (reserved) saved = observe({ ...saved, retryFailures: failures + 1 });
      return reserved;
    };
    const failure = async (result: Failure) => {
      if (result.remoteId) await store.bindRemote(key, { remoteId: result.remoteId });
      if (!(await refresh())) return soon();
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
    const refresh = async () => {
      diagnosticState.retryFailures = undefined;
      saved = observe(await store.desire(await load()));
      if (terminal()) return false;
      return saved.desiredRevision === initial.desiredRevision;
    };
    const complete = async () => {
      if (!(await refresh())) return soon();
      diagnosticState.retryFailures = undefined;
      const synced = await store.markSynced(
        key,
        saved.desiredRevision,
        payload.eventType === "crm.reconciliation.requested" ? payload.eventId : undefined,
      );
      if (synced) saved = observe({ ...saved, retryFailures: 0 });
      if (payload.kind === "organization") await fanout(saved.desired, helpers, payload);
      report("synced");
    };
    async function syncOrganization(payload: OrganizationSyncPayload) {
      const snapshot = saved.desired;
      if (snapshot.kind !== "organization" || snapshot.deleted) return;
      if (!(await reserve())) return soon();
      if (!saved.remoteId) {
        if (saved.companyCreateAttemptedAt) {
          const found = await adapter.recoverCompany(snapshot.externalId, helpers.abortSignal);
          if (!found.ok) return failure(found);
          // Recover an old accepted POST even if authoritative desired state advanced.
          await store.bindRemote(key, { remoteId: found.value.id });
          await store.companyRead(payload.organizationId, found.value);
          await refresh();
          return soon();
        }
        if (!(await refresh())) return soon();
        if (!(await store.companyCreateIntent(payload.organizationId, saved.desiredRevision)))
          return soon();
        const result = await adapter.createCompany(snapshot, helpers.abortSignal);
        if (result.ok) await store.bindRemote(key, { remoteId: result.value.id });
        else {
          if (result.remoteId) await store.bindRemote(key, { remoteId: result.remoteId });
          // Adapter only classifies cancellation as such before a POST was sent.
          // A sent/unknown create is ambiguous and NEVER authorizes a second POST.
          if (deferred(result)) await store.refundCompanyCreateIntent(payload.organizationId);
          await refresh();
          return failure(result);
        }
        return complete();
      }
      const remoteId = saved.remoteId;
      let current = saved.companyRead;
      if (!current) {
        const result = await adapter.getCompany(saved.remoteId, helpers.abortSignal);
        if (!result.ok)
          return failure(
            result.kind === "not_found"
              ? { ...result, kind: "permanent", code: "mapped_company_missing" }
              : result,
          );
        current = result.value;
        if (
          current.id !== saved.remoteId ||
          current.attributes.everr_org_id !== snapshot.externalId
        )
          return block("remote_identity_conflict");
        await store.companyRead(payload.organizationId, current);
      }
      if (!(await refresh())) return soon();
      if (current.id !== saved.remoteId || current.attributes.everr_org_id !== snapshot.externalId)
        return block("remote_identity_conflict");
      const result = await adapter.updateCompany(remoteId, snapshot, helpers.abortSignal, current);
      if (!result.ok) return failure(result);
      if (result.changed) reconciliationDiagnostic("drift", { kind: "organization" });
      await store.companyRead(payload.organizationId, null);
      return complete();
    }
    async function syncMembership(payload: MembershipSyncPayload) {
      const snapshot = saved.desired;
      const linked = !snapshot.deleted;
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
          if (!(await refresh())) return soon();
          return block("parent_deletion_cleanup_required");
        }
        if (
          [contact, company].some(
            (parent) => parent.outcome === "blocked" || parent.retryFailures >= USER_SYNC_RETRIES,
          )
        )
          return block("prerequisite_blocked");
        if (!contact.remoteId || !company.remoteId) {
          const origin = {
            version: 1,
            eventId: payload.eventId,
            occurredAt: payload.occurredAt,
            failures: 0,
          };
          if (!contact.remoteId)
            await helpers.addJob(
              USER_SYNC_TASK,
              { ...origin, userId: payload.userId, eventType: "identity.user.updated" },
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
                eventType: payload.eventType,
              },
              {
                ...relatedSyncSpec(payload.organizationId),
              },
            );
          return defer(new Date(Date.now() + 60_000));
        }
        saved = observe(
          await store.bindRemote(key, {
            remoteContactId: contact.remoteId,
            remoteCompanyId: company.remoteId,
          }),
        );
      }
      // No mapping means this pair never linked, so removing it requires no provider call.
      if (!saved.remoteContactId || !saved.remoteCompanyId) return complete();
      const remoteCompanyId = saved.remoteCompanyId;
      const remoteContactId = saved.remoteContactId;
      if (!(await refresh())) return soon();
      // Refresh the source parents before a link, including terminal retained tombstones.
      if (linked) {
        const parents = await Promise.all([
          store.desire(await reader.user(payload.userId)),
          store.desire(await reader.organization(payload.organizationId)),
        ]);
        if (parents.some((parent) => parent.desired.deleted || parent.deletedAt)) {
          if (!(await refresh())) return soon();
          return block("parent_deletion_cleanup_required");
        }
        if (
          parents.some(
            (parent) => parent.outcome === "blocked" || parent.retryFailures >= USER_SYNC_RETRIES,
          )
        )
          return block("prerequisite_blocked");
      }
      const contactId = Number(remoteContactId);
      if (!Number.isSafeInteger(contactId) || contactId <= 0)
        return block("invalid_contact_mapping");
      if (!(await reserve())) return soon();
      if (!linked) {
        const contact = await adapter.getContact(
          projectionIdentity(options.deployment, { kind: "user", id: payload.userId }).externalId,
          helpers.abortSignal,
        );
        if (!contact.ok) return contact.kind === "not_found" ? complete() : failure(contact);
        if (
          String(contact.value.id) !== remoteContactId ||
          contact.value.attributes.EXT_ID !==
            projectionIdentity(options.deployment, { kind: "user", id: payload.userId }).externalId
        )
          return block("remote_identity_conflict");
        let company = saved.cleanupCompanyRead;
        if (!company) {
          const result = await adapter.getCompany(remoteCompanyId, helpers.abortSignal);
          if (!result.ok) return result.kind === "not_found" ? complete() : failure(result);
          company = result.value;
          if (
            company.id !== remoteCompanyId ||
            company.attributes.everr_org_id !==
              projectionIdentity(options.deployment, {
                kind: "organization",
                id: payload.organizationId,
              }).externalId
          )
            return block("remote_identity_conflict");
          await store.cleanupCompanyRead(key, company);
          saved = observe({ ...saved, cleanupCompanyRead: company });
        }
        if (
          company.id !== remoteCompanyId ||
          company.attributes.everr_org_id !==
            projectionIdentity(options.deployment, {
              kind: "organization",
              id: payload.organizationId,
            }).externalId
        )
          return block("remote_identity_conflict");
        if (!(await refresh())) return soon();
      }
      if (linked) {
        let company = saved.cleanupCompanyRead;
        if (!company) {
          const result = await adapter.getCompany(remoteCompanyId, helpers.abortSignal);
          if (!result.ok)
            return result.kind === "not_found" ? block("mapped_company_missing") : failure(result);
          company = result.value;
          if (
            company.id !== remoteCompanyId ||
            company.attributes.everr_org_id !==
              projectionIdentity(options.deployment, {
                kind: "organization",
                id: payload.organizationId,
              }).externalId
          )
            return block("remote_identity_conflict");
          await store.cleanupCompanyRead(key, company);
          saved = observe({ ...saved, cleanupCompanyRead: company });
        }
        if (
          company.id !== remoteCompanyId ||
          company.attributes.everr_org_id !==
            projectionIdentity(options.deployment, {
              kind: "organization",
              id: payload.organizationId,
            }).externalId
        )
          return block("remote_identity_conflict");
        if (!(await refresh())) return soon();
        if (company.linkedContactsIds?.includes(contactId)) return complete();
      } else if (
        saved.cleanupCompanyRead?.linkedContactsIds &&
        !saved.cleanupCompanyRead.linkedContactsIds.includes(contactId)
      )
        return complete();
      const result = await adapter.associate(
        remoteCompanyId,
        contactId,
        linked,
        helpers.abortSignal,
      );
      if (!result.ok && !(result.kind === "not_found" && !linked)) return failure(result);
      if (result.ok) reconciliationDiagnostic("drift", { kind: "membership" });
      if (!(await refresh())) return soon();
      // A source pair may be removed/re-added during HTTP. The next revision corrects it.
      if (linked) {
        const parents = await Promise.all([
          store.desire(await reader.user(payload.userId)),
          store.desire(await reader.organization(payload.organizationId)),
        ]);
        if (parents.some((parent) => parent.desired.deleted || parent.deletedAt)) {
          if (!(await refresh())) return soon();
          return block("parent_deletion_cleanup_required");
        }
        if (
          parents.some(
            (parent) => parent.outcome === "blocked" || parent.retryFailures >= USER_SYNC_RETRIES,
          )
        )
          return block("prerequisite_blocked");
      }
      await store.cleanupCompanyRead(key, null);
      return complete();
    }
    return payload.kind === "organization" ? syncOrganization(payload) : syncMembership(payload);
  };
  return async (payload, helpers) => {
    // Ephemeral diagnostics only. Provider policy always uses the loaded projection row.
    const diagnosticState: { retryFailures?: number } = {};
    try {
      await execute(payload, helpers, diagnosticState);
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
