import type { Database } from "@everr/app/db/database";
import { BrevoFailure, requireBrevo, type createBrevoAdapter } from "./brevo/adapter";
import { saveCompanyId } from "./metadata";
import {
  externalIdentity,
  sourceIdentity,
  type createCrmSnapshotReader,
  type SourceSnapshot,
} from "./snapshots";

/** Called only by tasks in the shared outbound queue. No source transaction spans HTTP. */
export function createCrmSync(options: {
  database: Database;
  reader: ReturnType<typeof createCrmSnapshotReader>;
  adapter: ReturnType<typeof createBrevoAdapter>;
}) {
  const { database, reader, adapter } = options;
  const signalFailure = () =>
    new BrevoFailure({ ok: false, kind: "identity_conflict", code: "remote_identity_conflict" });

  async function contact(userId: string, signal?: AbortSignal) {
    const externalId = externalIdentity("user", userId);
    const result = await adapter.getContact(externalId, signal);
    if (!result.ok && result.kind === "not_found") return;
    const current = requireBrevo(result);
    if (current.attributes.EXT_ID !== externalId) throw signalFailure();
    return current;
  }

  async function company(source: SourceSnapshot, signal?: AbortSignal) {
    if (source.kind !== "organization") throw new Error("Invalid CRM organization source.");
    if (!source.deleted && source.companyId) {
      const result = await adapter.getCompany(source.companyId, signal);
      if (result.ok && result.value.attributes.everr_org_id === source.externalId)
        return result.value;
      if (!result.ok && result.kind !== "not_found") throw new BrevoFailure(result);
      // A copied database can contain an ID from a different Brevo account.
      // Never modify that record. Resolve the expected source identity instead.
    }
    return requireBrevo(await adapter.findCompany(source.externalId, signal));
  }

  async function user(userId: string, signal?: AbortSignal, prune = false) {
    const current = await contact(userId, signal);
    // Lookup can wait for backpressure. Refresh before deciding whether to write.
    const source = await reader.user(userId);
    if (source.deleted) {
      if (current) {
        if (prune) {
          const companies = requireBrevo(await adapter.listCompanies(signal));
          if (
            companies.some(
              (company) =>
                company.linkedContactsIds?.includes(current.id) &&
                !sourceIdentity("organization", company.attributes.everr_org_id),
            )
          )
            throw new BrevoFailure({
              ok: false,
              kind: "identity_conflict",
              code: "foreign_associations_present",
            });
        }
        const result = await adapter.deleteContact(current.id, signal);
        if (!result.ok && result.kind !== "not_found") throw new BrevoFailure(result);
      }
      return { source, remoteId: undefined };
    }
    if (source.kind !== "user") throw new Error("Invalid CRM user source.");
    if (current) {
      requireBrevo(await adapter.updateContact(source, current, signal));
      return { source, remoteId: current.id };
    }
    const result = await adapter.createContact(source, signal);
    if (!result.ok && result.kind === "ambiguous_create") {
      // Contacts have unique external identities. The next Graphile attempt looks up first.
      throw new BrevoFailure({ ...result, kind: "transient" });
    }
    return { source, remoteId: requireBrevo(result).id };
  }

  async function organization(organizationId: string, signal?: AbortSignal, prune = false) {
    const current = await company(await reader.organization(organizationId), signal);
    const source = await reader.organization(organizationId);
    if (source.deleted) {
      if (current) {
        if (prune && current.linkedContactsIds?.length) {
          const contacts = requireBrevo(await adapter.listContacts(signal));
          const ownedIds = new Set(
            contacts
              .filter((contact) => sourceIdentity("user", contact.attributes.EXT_ID))
              .map((contact) => contact.id),
          );
          if (current.linkedContactsIds.some((id) => !ownedIds.has(id)))
            throw new BrevoFailure({
              ok: false,
              kind: "identity_conflict",
              code: "foreign_associations_present",
            });
        }
        const result = await adapter.deleteCompany(current.id, signal);
        if (!result.ok && result.kind !== "not_found") throw new BrevoFailure(result);
      }
      return { source, remoteId: undefined };
    }
    if (source.kind !== "organization") throw new Error("Invalid CRM organization source.");
    let remoteId: string;
    if (current) {
      requireBrevo(await adapter.updateCompany(source, current, signal));
      remoteId = current.id;
    } else {
      // An ambiguous POST is terminal for this command. Never blindly retry it here.
      remoteId = requireBrevo(await adapter.createCompany(source, signal)).id;
    }
    await saveCompanyId(database, organizationId, remoteId);
    return { source, remoteId };
  }

  async function membership(
    userId: string,
    organizationId: string,
    signal?: AbortSignal,
    prune = false,
  ) {
    const initiallyLinked = await reader.membership(userId, organizationId);
    let contactId: number | undefined;
    let companyId: string | undefined;
    if (initiallyLinked) {
      contactId = (await user(userId, signal, prune)).remoteId;
      companyId = (await organization(organizationId, signal, prune)).remoteId;
    } else {
      contactId = (await contact(userId, signal))?.id;
      companyId = (await company(await reader.organization(organizationId), signal))?.id;
    }
    const linked = await reader.membership(userId, organizationId);
    if (!contactId || !companyId) return linked;
    const remote = await adapter.getCompany(companyId, signal);
    if (!remote.ok && remote.kind === "not_found" && !linked) return linked;
    const current = requireBrevo(remote);
    if (current.attributes.everr_org_id !== externalIdentity("organization", organizationId))
      throw signalFailure();
    if (current.linkedContactsIds && current.linkedContactsIds.includes(contactId) === linked)
      return linked;
    const result = await adapter.associate(companyId, contactId, linked, signal);
    if (!result.ok && !(result.kind === "not_found" && !linked)) throw new BrevoFailure(result);
    return linked;
  }
  return { user, organization, membership };
}
