import { and, eq, isNull, or, sql } from "drizzle-orm";
import { member, organization, orgSubscription, user } from "@/db/schema";
import {
  isOrganizationAdmin,
  isOrganizationOwner,
} from "@/lib/organization-role";
import { assertPolarProductGrantsPlan } from "./catalog.server";
import {
  type BillingDependencies,
  BillingError,
  type Subscription,
} from "./types";

export function createBillingStore({ db }: BillingDependencies) {
  const store = {
    async person(id: string) {
      const [person] = await db
        .select({ id: user.id, name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, id));
      if (!person)
        throw new BillingError(
          "identity_conflict",
          "Billing user no longer exists.",
        );
      return person;
    },
    async organization(id: string) {
      const [org] = await db
        .select()
        .from(organization)
        .where(eq(organization.id, id));
      if (!org)
        throw new BillingError(
          "identity_conflict",
          "Organization no longer exists.",
        );
      return org;
    },
    async linkCustomer(orgId: string, customerId: string) {
      const updated = await db
        .update(organization)
        .set({ polarCustomerId: customerId })
        .where(
          and(
            eq(organization.id, orgId),
            or(
              isNull(organization.polarCustomerId),
              eq(organization.polarCustomerId, customerId),
            ),
          ),
        )
        .returning({ id: organization.id });
      if (!updated.length)
        throw new BillingError(
          "identity_conflict",
          "Organization already has a different billing customer.",
        );
    },
    async people(orgId: string) {
      return db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          role: member.role,
          joinedAt: member.createdAt,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(eq(member.organizationId, orgId));
    },
    async authorize(orgId: string, userId: string, ownerOnly = false) {
      const [row] = await db
        .select({ role: member.role })
        .from(member)
        .where(
          and(eq(member.organizationId, orgId), eq(member.userId, userId)),
        );
      if (
        !(ownerOnly
          ? isOrganizationOwner(row?.role)
          : isOrganizationAdmin(row?.role))
      )
        throw new BillingError(
          "forbidden",
          "You cannot manage billing for this organization.",
        );
    },
    async saveSubscription(orgId: string, subscription: Subscription) {
      assertPolarProductGrantsPlan(subscription.productId, "pro");
      const values = {
        orgId,
        polarSubscriptionId: subscription.id,
        polarProductId: subscription.productId,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        polarModifiedAt: subscription.modifiedAt ?? subscription.createdAt,
      };
      await db.transaction(async (tx) => {
        const updated = await tx
          .insert(orgSubscription)
          .values(values)
          .onConflictDoUpdate({
            target: orgSubscription.orgId,
            set: { ...values, updatedAt: new Date() },
            setWhere: sql`${orgSubscription.polarModifiedAt} < ${values.polarModifiedAt}`,
          })
          .returning();
        if (updated.length && subscription.status === "active")
          await tx
            .update(organization)
            .set({ plan: "pro" })
            .where(eq(organization.id, orgId));
      });
    },
  };
  return store;
}
export type BillingStore = ReturnType<typeof createBillingStore>;
