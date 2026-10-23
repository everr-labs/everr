import type { JobHelpers, Task } from "graphile-worker";
import type { createBrevoAdapter } from "./brevo/adapter";
import {
  MEMBERSHIP_SYNC_TASK,
  ORGANIZATION_SYNC_TASK,
  USER_SYNC_RETRIES,
  USER_SYNC_TASK,
  membershipSyncPayload,
  organizationSyncPayload,
  relatedSyncSpec,
  userSyncSpec,
  type MembershipSyncPayload,
  type OrganizationSyncPayload,
  type UserSyncPayload,
} from "./jobs";
import type { createCrmSnapshotReader, DesiredProjection } from "./snapshots";
import type { createCrmProjectionStore } from "./store";
import { syncDiagnostic, type SyncDiagnostic } from "./telemetry";
import { RetainedCrmWork } from "./user-sync";

type Payload = MembershipSyncPayload | OrganizationSyncPayload;
type Store = ReturnType<typeof createCrmProjectionStore>;
type Reader = ReturnType<typeof createCrmSnapshotReader>;
type Adapter = Pick<
  ReturnType<typeof createBrevoAdapter>,
  "getCompany" | "recoverCompany" | "createCompany" | "updateCompany" | "associate"
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
    if (snapshot.kind === "membership" || snapshot.deleted) return;
    const prior = await store.memberships(
      snapshot.kind === "user"
        ? { userId: snapshot.sourceId }
        : { organizationId: snapshot.sourceId },
    );
    const pairs = new Map<string, { userId: string; organizationId: string }>();
    for (const pair of [...prior, ...snapshot.memberships]) {
      if (!pair.userId || !pair.organizationId) continue;
      pairs.set(JSON.stringify([pair.userId, pair.organizationId]), {
        userId: pair.userId,
        organizationId: pair.organizationId,
      });
    }
    for (const pair of pairs.values()) {
      await helpers.addJob(
        MEMBERSHIP_SYNC_TASK,
        {
          version: 1,
          kind: "membership",
          ...pair,
          eventId: origin.eventId,
          eventType: origin.eventType,
          occurredAt: origin.occurredAt,
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
export function createRelatedSyncTasks(options: {
  deployment: string;
  reader: Reader;
  store: Store;
  adapter: Adapter;
  diagnostic?: SyncDiagnostic;
}) {
  const { reader, store, adapter, diagnostic = syncDiagnostic } = options;
  const fanout = membershipFanout(store);
  function task(kind: Payload["kind"]): Task {
    const schema = kind === "organization" ? organizationSyncPayload : membershipSyncPayload;
    const identifier = kind === "organization" ? ORGANIZATION_SYNC_TASK : MEMBERSHIP_SYNC_TASK;
    const execute: Task = async (raw, helpers) => {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        diagnostic("invalid", undefined, String(helpers.job.id));
        throw new RetainedCrmWork("Invalid CRM related task payload.");
      }
      const payload = parsed.data;
      const load = () =>
        payload.kind === "organization"
          ? reader.organization(payload.organizationId)
          : reader.membership(payload.userId, payload.organizationId);
      let saved = await store.desire(await load());
      const initial = saved;
      const key = { kind: saved.kind, sourceId: saved.sourceId };
      const report = (outcome: Parameters<SyncDiagnostic>[0]) =>
        diagnostic(outcome, payload, String(helpers.job.id));
      const failures = Math.max(
        saved.retryFailures,
        payload.desiredRevision === saved.desiredRevision ? payload.failures : 0,
      );
      let reserved = false;
      const defer = async (at: Date, nextFailures = failures) => {
        if (reserved && nextFailures === failures)
          await store.setRetryFailures(key, initial.desiredRevision, failures + 1, failures);
        await helpers.addJob(
          identifier,
          {
            ...payload,
            desiredRevision: saved.desiredRevision,
            failures:
              saved.desiredRevision === initial.desiredRevision
                ? nextFailures
                : saved.retryFailures,
          },
          {
            ...relatedSyncSpec(
              payload.organizationId,
              payload.kind === "membership" ? payload.userId : undefined,
            ),
            runAt: at,
          },
        );
        report(nextFailures === failures ? "deferred" : "retry");
      };
      const soon = () => defer(new Date(Date.now() + 1000));
      const block = async (code: string) => {
        await store.markFailed(key, saved.desiredRevision, code, true);
        report("blocked");
        throw new RetainedCrmWork("CRM synchronization requires inspection.");
      };
      const terminal = () =>
        saved.kind !== "membership" && (saved.desired.deleted || !!saved.deletedAt);
      if (terminal()) return block("deletion_cleanup_required");
      if (saved.syncedRevision === saved.desiredRevision) {
        if (kind === "organization") await fanout(saved.desired, helpers, payload);
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
        await store.setRetryFailures(key, saved.desiredRevision, saved.retryFailures, failures);
        await store.markFailed(key, saved.desiredRevision, "retry_budget_exhausted");
        report("exhausted");
        throw new RetainedCrmWork("CRM retry allowance exhausted.");
      }
      const reserve = async () => {
        reserved = await store.setRetryFailures(
          key,
          saved.desiredRevision,
          saved.retryFailures,
          failures + 1,
        );
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
      const refresh = async () => {
        saved = await store.desire(await load());
        if (terminal()) return block("deletion_cleanup_required");
        return saved.desiredRevision === initial.desiredRevision;
      };
      const complete = async () => {
        if (!(await refresh())) return soon();
        await store.markSynced(key, saved.desiredRevision);
        if (kind === "organization") await fanout(saved.desired, helpers, payload);
        report("synced");
      };
      if (payload.kind === "organization") {
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
        if (
          current.id !== saved.remoteId ||
          current.attributes.everr_org_id !== snapshot.externalId
        )
          return block("remote_identity_conflict");
        const result = await adapter.updateCompany(
          remoteId,
          snapshot,
          helpers.abortSignal,
          current,
        );
        if (!result.ok) return failure(result);
        await store.companyRead(payload.organizationId, null);
        return complete();
      }
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
        saved = await store.bindRemote(key, {
          remoteContactId: contact.remoteId,
          remoteCompanyId: company.remoteId,
        });
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
      const result = await adapter.associate(
        remoteCompanyId,
        contactId,
        linked,
        helpers.abortSignal,
      );
      if (!result.ok && !(result.kind === "not_found" && !linked)) return failure(result);
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
      return complete();
    };
    return async (raw, helpers) => {
      try {
        await execute(raw, helpers);
      } catch (error) {
        if (error instanceof RetainedCrmWork) throw error;
        const parsed = schema.safeParse(raw);
        diagnostic(
          helpers.job.attempts >= helpers.job.max_attempts ? "exhausted" : "retry",
          parsed.success ? parsed.data : undefined,
          String(helpers.job.id),
        );
        // eslint-disable-next-line preserve-caught-error -- Raw DB/provider errors may contain profile data.
        throw new Error("CRM task failed; persisted work remains available for retry.");
      }
    };
  }
  return { organization: task("organization"), membership: task("membership") };
}
