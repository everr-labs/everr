import type { JobHelpers } from "graphile-worker";
import { requireBrevo, type createBrevoAdapter } from "./brevo/adapter";
import {
  MEMBERSHIP_SYNC_TASK,
  ORGANIZATION_SYNC_TASK,
  USER_SYNC_TASK,
  relatedSyncSpec,
  userSyncSpec,
  type FullSyncPayload,
} from "./commands";
import { sourceIdentity, type createCrmSnapshotReader } from "./snapshots";
import { syncDiagnostic, type SyncDiagnostic } from "./telemetry";

/** Manual, restartable admission only. Queued children run after this scan releases the queue. */
export function createFullSync(options: {
  reader: ReturnType<typeof createCrmSnapshotReader>;
  adapter: ReturnType<typeof createBrevoAdapter>;
  diagnostic?: SyncDiagnostic;
}) {
  const { reader, adapter, diagnostic = syncDiagnostic } = options;
  return async (payload: FullSyncPayload, helpers: JobHelpers) => {
    let admitted = 0;
    let candidates = 0;
    const origin = {
      version: 1 as const,
      eventId: payload.eventId,
      eventType: payload.eventType,
      occurredAt: payload.occurredAt,
      prune: payload.prune,
    };
    const admit = async (kind: "user" | "organization", id: string, candidate = false) => {
      const command =
        kind === "user" ? { ...origin, userId: id } : { ...origin, kind, organizationId: id };
      if (candidate) {
        candidates++;
        diagnostic("preview", command, String(helpers.job.id), { operation: "delete" });
      }
      if (payload.prune && !payload.apply) return;
      await helpers.addJob(
        kind === "user" ? USER_SYNC_TASK : ORGANIZATION_SYNC_TASK,
        command,
        kind === "user" ? userSyncSpec(id) : relatedSyncSpec(id),
      );
      admitted++;
    };
    if (!payload.prune || payload.apply) {
      for await (const source of reader.sources()) {
        helpers.abortSignal?.throwIfAborted();
        await admit(source.kind, source.id);
      }
    }
    if (payload.prune) {
      const contacts = requireBrevo(await adapter.listContacts(helpers.abortSignal));
      const companies = requireBrevo(await adapter.listCompanies(helpers.abortSignal));
      const ownedUsers = new Map<number, string>();
      for (const contact of contacts) {
        const userId = sourceIdentity("user", contact.attributes.EXT_ID);
        if (userId) ownedUsers.set(contact.id, userId);
      }
      const foreignLinkedUsers = new Set(
        companies
          .filter((company) => !sourceIdentity("organization", company.attributes.everr_org_id))
          .flatMap((company) => company.linkedContactsIds ?? []),
      );
      for (const [contactId, userId] of ownedUsers) {
        if (!(await reader.user(userId)).deleted) continue;
        if (foreignLinkedUsers.has(contactId)) {
          diagnostic("failed", { ...origin, userId }, String(helpers.job.id), {
            code: "foreign_associations_present",
            operation: "prune",
          });
          continue;
        }
        await admit("user", userId, true);
      }
      const identities = new Map<string, number>();
      for (const company of companies) {
        const id = sourceIdentity("organization", company.attributes.everr_org_id);
        if (id) identities.set(id, (identities.get(id) ?? 0) + 1);
      }
      for (const company of companies) {
        helpers.abortSignal?.throwIfAborted();
        const organizationId = sourceIdentity("organization", company.attributes.everr_org_id);
        if (!organizationId) continue;
        if (identities.get(organizationId) !== 1) {
          diagnostic(
            "failed",
            { ...origin, kind: "organization", organizationId },
            String(helpers.job.id),
            { code: "multiple_remote_identities", operation: "prune" },
          );
          continue;
        }
        if ((await reader.organization(organizationId)).deleted) {
          if (company.linkedContactsIds?.some((id) => !ownedUsers.has(id))) {
            diagnostic(
              "failed",
              { ...origin, kind: "organization", organizationId },
              String(helpers.job.id),
              { code: "foreign_associations_present", operation: "prune" },
            );
            continue;
          }
          await admit("organization", organizationId, true);
        }
        for (const contactId of company.linkedContactsIds ?? []) {
          const userId = ownedUsers.get(contactId);
          if (!userId || (await reader.membership(userId, organizationId))) continue;
          const command = { ...origin, kind: "membership" as const, organizationId, userId };
          candidates++;
          diagnostic("preview", command, String(helpers.job.id), { operation: "unlink" });
          if (payload.apply) {
            await helpers.addJob(
              MEMBERSHIP_SYNC_TASK,
              command,
              relatedSyncSpec(organizationId, userId),
            );
            admitted++;
          }
        }
      }
    }
    diagnostic(
      payload.prune && !payload.apply ? "preview" : "admitted",
      payload,
      String(helpers.job.id),
      { admitted, candidates, operation: "scan" },
    );
  };
}
