import { member, organization, user } from "@everr/app/db/schema";
import { isOrganizationAdmin, isOrganizationOwner } from "@everr/app/identity/roles";
import { and, eq, getTableColumns, isNull, or, sql } from "drizzle-orm";
import { organizationBilling, orgSubscription } from "../db/schema";
import { organizationPlanChanged } from "./events";
import { assertPolarProductGrantsPlan } from "./catalog.server";
import { type BillingDependencies, BillingError, type Subscription } from "./types";

export function createBillingStore({ db, events }: BillingDependencies) {
  const store = {
    async person(id: string) {
      const [person] = await db
        .select({ id: user.id, name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, id));
      if (!person) throw new BillingError("identity_conflict", "Billing user no longer exists.");
      return person;
    },
    async organization(id: string) {
      const [org] = await db
        .select({
          ...getTableColumns(organization),
          plan: sql<"hobby" | "pro">`coalesce(${organizationBilling.plan}, 'hobby')`,
          polarCustomerId: organizationBilling.polarCustomerId,
        })
        .from(organization)
        .leftJoin(organizationBilling, eq(organizationBilling.orgId, organization.id))
        .where(eq(organization.id, id));
      if (!org) throw new BillingError("identity_conflict", "Organization no longer exists.");
      return org;
    },
    async linkCustomer(orgId: string, customerId: string) {
      const updated = await db
        .insert(organizationBilling)
        .values({ orgId, polarCustomerId: customerId })
        .onConflictDoUpdate({
          target: organizationBilling.orgId,
          set: { polarCustomerId: customerId },
          setWhere: or(
            isNull(organizationBilling.polarCustomerId),
            eq(organizationBilling.polarCustomerId, customerId),
          ),
        })
        .returning({ id: organizationBilling.orgId });
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
        .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)));
      if (!(ownerOnly ? isOrganizationOwner(row?.role) : isOrganizationAdmin(row?.role)))
        throw new BillingError("forbidden", "You cannot manage billing for this organization.");
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
      const changes = await db.transaction(async (tx) => {
        const updated = await tx
          .insert(orgSubscription)
          .values(values)
          .onConflictDoUpdate({
            target: orgSubscription.orgId,
            set: { ...values, updatedAt: new Date() },
            setWhere: sql`${orgSubscription.polarModifiedAt} < ${values.polarModifiedAt}`,
          })
          .returning();
        if (!updated.length) return;
        let planChanged = false;
        if (subscription.status === "active") {
          const changed = await tx
            .insert(organizationBilling)
            .values({ orgId, plan: "pro" })
            .onConflictDoUpdate({
              target: organizationBilling.orgId,
              set: { plan: "pro" },
              setWhere: sql`${organizationBilling.plan} <> 'pro'`,
            })
            .returning({ id: organizationBilling.orgId });
          planChanged = changed.length > 0;
        }
        return { planChanged };
      });
      if (!changes) return;
      await events.publish({
        type: "billing.subscription.changed",
        version: 1,
        subjectId: orgId,
        data: { organizationId: orgId, subscriptionId: subscription.id },
      });
      if (changes.planChanged) await events.publish(organizationPlanChanged(orgId, "hobby", "pro"));
    },
  };
  return store;
}
export type BillingStore = ReturnType<typeof createBillingStore>;
