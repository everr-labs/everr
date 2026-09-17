import { eq } from "drizzle-orm";
import { member, orgSubscription } from "@/db/schema";
import { isOrganizationOwner } from "@/lib/organization-role";
import { createBillingCheckouts } from "./checkout";
import { createBillingIdentity } from "./identity";
import { createBillingStore } from "./store";
import { createBillingSubscriptions } from "./subscription";
import { type BillingDependencies, BillingError, type Person } from "./types";

export function createBillingModule(deps: BillingDependencies) {
  const { db, polar, lock } = deps;
  const store = createBillingStore(deps);
  const identity = createBillingIdentity(deps, store);
  const checkout = createBillingCheckouts(deps, store, identity);
  const subscriptions = createBillingSubscriptions(deps, store, identity);
  async function userOrganizations(userId: string) {
    return db
      .select({ orgId: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId));
  }
  return {
    startNewOrganizationCheckout: checkout.startNew,
    startUpgradeCheckout: checkout.startUpgrade,
    completeNewOrganizationCheckout: subscriptions.completeNew,
    confirmUpgradeCheckout: subscriptions.completeUpgrade,
    syncSubscription: subscriptions.syncSubscription,
    openPortal: identity.portal,
    changeOwner: identity.changeOwner,
    beforeMembershipChange: identity.beforeMembershipChange,
    afterMembershipChange: identity.afterMembershipChange,
    async getSettings(orgId: string, actorId: string) {
      await store.authorize(orgId, actorId);
      const customer = await identity.customerForOrganization(orgId);
      const people = await store.people(orgId);
      const actor = people.find((p) => p.id === actorId);
      return {
        owner: await identity.owner(orgId),
        candidates: people.filter((p) => isOrganizationOwner(p.role)),
        canChangeOwner:
          Boolean(customer?.id) && isOrganizationOwner(actor?.role),
        connected: Boolean(customer?.id),
      };
    },
    async assertDeletable(orgId: string) {
      return lock(`billing:${orgId}`, async () => {
        const customer = await identity.customerForOrganization(orgId);
        if (customer)
          throw new BillingError(
            "forbidden",
            "Organizations connected to billing cannot be deleted yet.",
          );
      });
    },
    async beforeUserUpdate(
      userId: string,
      update: Partial<Person> & { emailVerified?: boolean },
    ) {
      if (update.name === undefined && update.email === undefined) return;
      const person = await store.person(userId);
      if (
        update.email !== undefined &&
        update.email !== person.email &&
        update.emailVerified !== true
      )
        throw new BillingError(
          "forbidden",
          "Verify the new email before updating billing identity.",
        );
      for (const { orgId } of await userOrganizations(userId)) {
        await lock(`billing:${orgId}`, async () => {
          const customer = await identity.customerForOrganization(orgId);
          if (!customer?.id) return;
          await identity.reconcile(orgId, {
            person: { ...person, ...update, id: userId },
          });
        });
      }
    },
    async afterUserUpdate(userId: string) {
      for (const { orgId } of await userOrganizations(userId))
        await identity.afterMembershipChange(orgId);
    },
    async beforeUserDelete(userId: string) {
      for (const { orgId } of await userOrganizations(userId))
        await identity.beforeMembershipChange(orgId, userId, null);
    },
    async downgrade<T>(
      orgId: string,
      actorId: string,
      commit: (revokeBillingAccess: () => Promise<void>) => Promise<T>,
    ): Promise<T> {
      return lock(`billing:${orgId}`, async () => {
        await store.authorize(orgId, actorId, true);
        const owner = await identity.owner(orgId);
        if (owner && owner.id !== actorId)
          throw new BillingError(
            "owner_required",
            "Transfer billing ownership to yourself before downgrading.",
          );
        // The caller holds its local eligibility lock and checks constraints
        // before invoking revocation, then commits the local downgrade.
        const result = await commit(async () => {
          await identity.reconcile(orgId, {
            remove: (await store.people(orgId))
              .filter((p) => p.id !== actorId)
              .map((p) => p.id),
          });
          const [subscription] = await db
            .select()
            .from(orgSubscription)
            .where(eq(orgSubscription.orgId, orgId));
          if (subscription)
            await polar.revokeSubscription(subscription.polarSubscriptionId);
        });
        await identity.reconcile(orgId);
        return result;
      });
    },
  };
}
