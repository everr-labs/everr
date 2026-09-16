import {
  isOrganizationAdmin,
  isOrganizationOwner,
} from "@/lib/organization-role";
import { serverLogger } from "@/telemetry/logger";
import { createBillingMembers } from "./members";
import type { BillingStore } from "./store";
import {
  type BillingDependencies,
  BillingError,
  type Customer,
  type Person,
} from "./types";

export function assertTeam(customer: Customer, orgId: string) {
  if (customer.type !== "team" || customer.externalId !== orgId)
    throw new BillingError(
      "identity_conflict",
      "Billing customer does not match this organization. Reconciliation is required.",
    );
}
export function createBillingIdentity(
  deps: BillingDependencies,
  store: BillingStore,
) {
  const { polar, lock } = deps;
  const reconcileMembers = createBillingMembers(deps);
  async function team(
    orgId: string,
    name: string,
    owner: Person,
    knownId?: string | null,
  ) {
    let customer = knownId
      ? await polar.getCustomer(knownId)
      : await polar.findCustomer(orgId);
    if (!customer) {
      try {
        customer = await polar.createTeam({ orgId, name, owner });
      } catch (cause) {
        customer = await polar.findCustomer(orgId);
        if (!customer)
          throw new BillingError(
            "unavailable",
            "Billing could not be started. Please try again.",
            cause,
          );
      }
    }
    assertTeam(customer, orgId);
    return customer;
  }
  async function customerForOrganization(orgId: string) {
    const org = await store.organization(orgId);
    const customer = org.polarCustomerId
      ? await polar.getCustomer(org.polarCustomerId)
      : await polar.findCustomer(orgId);
    if (customer) {
      assertTeam(customer, orgId);
      if (!org.polarCustomerId) await store.linkCustomer(orgId, customer.id);
    }
    return customer;
  }
  async function owner(orgId: string) {
    const customer = await customerForOrganization(orgId);
    if (!customer?.id) return null;
    const owners = (await polar.members(customer.id)).filter(
      (m) => m.role === "owner",
    );
    if (owners.length !== 1 || !owners[0].externalId)
      throw new BillingError(
        "identity_conflict",
        "The billing owner is not linked to an Everr user.",
      );
    const person = (await store.people(orgId)).find(
      (p) => p.id === owners[0].externalId && isOrganizationOwner(p.role),
    );
    if (!person)
      throw new BillingError(
        "owner_required",
        "The Polar billing owner must be an organization owner.",
      );
    return person;
  }
  async function reconcile(
    orgId: string,
    overrides?: { ownerUserId?: string; remove?: string[]; person?: Person },
  ) {
    const customer = await customerForOrganization(orgId);
    if (!customer?.id) return;
    const billingOwner = overrides?.ownerUserId ?? (await owner(orgId))?.id;
    if (!billingOwner)
      throw new BillingError("owner_required", "Billing owner is missing.");
    const ownerUserId = billingOwner;
    const people = (await store.people(orgId)).filter(
      (p) => !overrides?.remove?.includes(p.id),
    );
    if (
      !people.some((p) => p.id === ownerUserId && isOrganizationOwner(p.role))
    )
      throw new BillingError(
        "owner_required",
        "Transfer billing ownership before removing or demoting its owner.",
      );
    const desired = people
      .filter((p) => isOrganizationAdmin(p.role))
      .map((p) =>
        overrides?.person?.id === p.id ? { ...p, ...overrides.person } : p,
      );
    await reconcileMembers(customer.id, ownerUserId, desired);
    serverLogger.info("billing.reconciliation.completed", {
      "everr.organization.id": orgId,
    });
  }

  return {
    team,
    owner,
    customerForOrganization,
    reconcile,
    async prepareCheckout(orgId: string, actorId: string) {
      await store.authorize(orgId, actorId);
      const people = await store.people(orgId);
      const initialOwner = people
        .filter((p) => isOrganizationOwner(p.role))
        .sort(
          (a, b) =>
            a.joinedAt.getTime() - b.joinedAt.getTime() ||
            a.id.localeCompare(b.id),
        )[0];
      if (!initialOwner)
        throw new BillingError(
          "owner_required",
          "An organization owner is required to start checkout.",
        );
      const org = await store.organization(orgId);
      const customer = await team(
        orgId,
        org.name,
        initialOwner,
        org.polarCustomerId,
      );
      await store.linkCustomer(orgId, customer.id);
      await reconcile(orgId);
      return customer;
    },
    async beforeMembershipChange(
      orgId: string,
      userId: string,
      nextRole: string | null,
    ) {
      return lock(`billing:${orgId}`, async () => {
        const customer = await customerForOrganization(orgId);
        if (!customer?.id) return;
        if (
          (await owner(orgId))?.id === userId &&
          !isOrganizationOwner(nextRole)
        )
          throw new BillingError(
            "owner_required",
            "Transfer billing ownership before removing or demoting its owner.",
          );
        if (!isOrganizationAdmin(nextRole))
          await reconcile(orgId, { remove: [userId] });
      });
    },
    async afterMembershipChange(orgId: string) {
      return lock(`billing:${orgId}`, async () => {
        if (!(await customerForOrganization(orgId))?.id) return;
        await reconcile(orgId);
      });
    },
    async portal(orgId: string, actorId: string) {
      return lock(`billing:${orgId}`, async () => {
        await store.authorize(orgId, actorId);
        const customer = await customerForOrganization(orgId);
        if (!customer?.id) return { status: "customer_missing" as const };
        await reconcile(orgId);
        const current = (await polar.members(customer.id)).find(
          (m) => m.externalId === actorId,
        );
        if (!current)
          throw new BillingError("forbidden", "Billing access is unavailable.");
        return {
          status: "ready" as const,
          url: await polar.portal(customer.id, current.id),
        };
      });
    },
    async changeOwner(orgId: string, actorId: string, ownerUserId: string) {
      return lock(`billing:${orgId}`, async () => {
        await store.authorize(orgId, actorId, true);
        await store.authorize(orgId, ownerUserId, true);
        const customer = await customerForOrganization(orgId);
        if (!customer?.id)
          throw new BillingError(
            "customer_missing",
            "Billing starts with the first checkout.",
          );
        await reconcile(orgId, { ownerUserId });
        await reconcile(orgId);
      });
    },
  };
}
