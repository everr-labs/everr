import {
  type BillingDependencies,
  BillingError,
  type BillingMember,
  type Person,
} from "./types";

export function createBillingMembers({ polar }: BillingDependencies) {
  async function resolveMember(
    customerId: string,
    person: Person,
    remote: BillingMember[],
  ) {
    let current = remote.find((m) => m.externalId === person.id);
    if (
      current &&
      (current.customerId !== customerId || current.externalId !== person.id)
    )
      throw new BillingError(
        "identity_conflict",
        "Billing member identity is inconsistent.",
      );
    if (
      remote.some(
        (m) =>
          m.id !== current?.id &&
          m.email.toLowerCase() === person.email.toLowerCase(),
      )
    )
      throw new BillingError(
        "identity_conflict",
        "This email belongs to another billing contact. Resolve the contact conflict in Polar.",
      );
    if (!current) {
      try {
        current = await polar.createMember(customerId, person);
      } catch (cause) {
        current = (await polar.members(customerId)).find(
          (m) => m.externalId === person.id,
        );
        if (!current) throw cause;
      }
    }
    if (current.externalId !== person.id || current.customerId !== customerId)
      throw new BillingError(
        "identity_conflict",
        "Billing member belongs to another user.",
      );
    return current;
  }
  async function syncMember(
    customerId: string,
    ownerUserId: string,
    person: Person,
    remote: BillingMember[],
  ) {
    const current = await resolveMember(customerId, person, remote);
    const role = person.id === ownerUserId ? "owner" : "billing_manager";
    if (
      current.role !== role ||
      current.name !== person.name ||
      current.email !== person.email
    )
      await polar.updateMember(current.id, {
        role,
        name: person.name,
        ...(current.email !== person.email ? { email: person.email } : {}),
      });
  }
  return async function reconcileMembers(
    customerId: string,
    ownerUserId: string,
    desired: Person[],
  ) {
    const remote = await polar.members(customerId);
    // externalId is reserved for Everr users. Independent contacts have none.
    for (const person of [...desired].sort(
      (a, b) => Number(b.id === ownerUserId) - Number(a.id === ownerUserId),
    ))
      await syncMember(customerId, ownerUserId, person, remote);
    for (const current of remote) {
      if (
        !current.externalId ||
        desired.some((p) => p.id === current.externalId)
      )
        continue;
      if (current.role === "owner")
        throw new BillingError(
          "owner_required",
          "Transfer billing ownership before removing its owner.",
        );
      await polar.deleteMember(current.id);
    }
  };
}
