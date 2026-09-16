import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { member, organization, proOrganizationCheckout } from "@/db/schema";
import { isOrganizationOwner } from "@/lib/organization-role";
import { creationLock, readIntent } from "./attempts";
import { assertTeam, type createBillingIdentity } from "./identity";
import { type CreationMetadata, creationMetadata } from "./metadata";
import { withOrganizationCreationId } from "./organization-context.server";
import type { BillingStore } from "./store";
import {
  type BillingDependencies,
  BillingError,
  type Checkout,
  type CreateOrganization,
  type SubscriptionEvent,
} from "./types";
import {
  assertSession,
  assertSubscription,
  verifyPayment,
} from "./verification";
export function createBillingSubscriptions(
  deps: BillingDependencies,
  store: BillingStore,
  identity: ReturnType<typeof createBillingIdentity>,
) {
  const { db, polar, lock } = deps;
  async function ensureOrganization(
    intent: Awaited<ReturnType<typeof readIntent>>,
    createOrganization: CreateOrganization,
  ) {
    let [org] = await db
      .select()
      .from(organization)
      .where(eq(organization.id, intent.orgId));
    if (!org) {
      if (intent.completedAt)
        throw new BillingError(
          "identity_conflict",
          "The checkout organization no longer exists.",
        );
      await withOrganizationCreationId(
        {
          id: intent.orgId,
          slug: intent.organizationSlug,
          ownerId: intent.ownerId,
        },
        () =>
          createOrganization({
            body: {
              name: intent.organizationName,
              slug: intent.organizationSlug,
              userId: intent.ownerId,
              plan: "pro",
            },
          }),
      );
      [org] = await db
        .select()
        .from(organization)
        .where(eq(organization.id, intent.orgId));
    }
    if (
      !org ||
      (!intent.completedAt &&
        (org.slug !== intent.organizationSlug ||
          org.name !== intent.organizationName))
    )
      throw new BillingError(
        "identity_conflict",
        "Organization does not match its creation request.",
      );
    const memberships = await db
      .select()
      .from(member)
      .where(eq(member.organizationId, org.id));
    if (!memberships.length && !intent.completedAt) {
      await db.insert(member).values({
        id: randomUUID(),
        organizationId: org.id,
        userId: intent.ownerId,
        role: "owner",
        createdAt: new Date(),
      });
    } else if (
      !intent.completedAt &&
      !memberships.some(
        (m) => m.userId === intent.ownerId && isOrganizationOwner(m.role),
      )
    )
      throw new BillingError(
        "identity_conflict",
        "Checkout owner does not match organization ownership.",
      );
    return org;
  }
  async function finalizeUnlocked(
    metadata: CreationMetadata,
    checkout: Checkout,
    createOrganization: CreateOrganization,
  ) {
    const parsed = creationMetadata.safeParse(checkout.metadata);
    if (
      !parsed.success ||
      JSON.stringify(parsed.data) !== JSON.stringify(metadata)
    )
      throw new BillingError(
        "identity_conflict",
        "Subscription checkout metadata does not match.",
      );
    const intent = await readIntent(db, metadata);
    if (!intent.polarCustomerId)
      throw new BillingError(
        "unsupported_checkout",
        "This checkout predates the supported billing flow.",
      );
    const subscription = await verifyPayment(
      polar,
      checkout,
      intent.orgId,
      intent.polarCustomerId,
    );
    if (!subscription) return { status: "processing" as const };
    const org = await ensureOrganization(intent, createOrganization);
    await store.linkCustomer(org.id, intent.polarCustomerId);
    const customer = await identity.customerForOrganization(org.id);
    if (customer?.id !== intent.polarCustomerId)
      throw new BillingError(
        "identity_conflict",
        "Organization has a different billing customer.",
      );
    if (!intent.completedAt) {
      await deps.provisionOrganization(org.id);
      await identity.reconcile(org.id);
    }
    await store.saveSubscription(org.id, subscription);
    await db
      .update(proOrganizationCheckout)
      .set({ completedAt: intent.completedAt ?? new Date() })
      .where(eq(proOrganizationCheckout.orgId, org.id));
    return {
      status: "completed" as const,
      organization: { id: org.id, name: org.name },
    };
  }
  async function finalize(
    metadata: CreationMetadata,
    checkout: Checkout,
    createOrganization: CreateOrganization,
  ) {
    return lock(`billing:${metadata.everrOrganizationId}`, () =>
      finalizeUnlocked(metadata, checkout, createOrganization),
    );
  }
  return {
    async completeNew(
      checkoutId: string,
      actorId: string,
      createOrganization: CreateOrganization,
    ) {
      const checkout = await polar.checkout(checkoutId);
      const parsed = creationMetadata.safeParse(checkout.metadata);
      if (!parsed.success)
        throw new BillingError(
          "unsupported_checkout",
          "This checkout is not supported.",
        );
      if (parsed.data.everrOwnerId !== actorId)
        throw new BillingError("forbidden", "This checkout is not available.");
      return lock(
        creationLock(actorId, parsed.data.everrOrganizationName),
        () => finalize(parsed.data, checkout, createOrganization),
      );
    },
    async completeUpgrade(orgId: string, actorId: string, checkoutId: string) {
      return lock(`billing:${orgId}`, async () => {
        await store.authorize(orgId, actorId);
        const customer = await identity.customerForOrganization(orgId);
        if (!customer?.id) return { status: "billing_conflict" as const };
        const checkout = await polar.checkout(checkoutId);
        if (checkout.metadata.orgId !== orgId || checkout.metadata.everrPurpose)
          return { status: "billing_conflict" as const };
        try {
          const subscription = await verifyPayment(
            polar,
            checkout,
            orgId,
            customer.id,
          );
          if (!subscription) return { status: "pending" as const };
          await store.saveSubscription(orgId, subscription);
          return { status: "completed" as const };
        } catch (error) {
          if (
            error instanceof BillingError &&
            error.code === "identity_conflict"
          )
            return { status: "billing_conflict" as const };
          throw error;
        }
      });
    },
    async syncSubscription(
      { data }: SubscriptionEvent,
      createOrganization: CreateOrganization,
    ) {
      const orgId = data.customer.externalId;
      if (!orgId || data.customer.id !== data.customerId)
        throw new BillingError(
          "identity_conflict",
          "Subscription customer is inconsistent.",
        );
      if (data.metadata.everrPurpose) {
        const parsed = creationMetadata.safeParse(data.metadata);
        if (!parsed.success || parsed.data.everrOrganizationId !== orgId)
          throw new BillingError(
            "unsupported_checkout",
            "Subscription uses unsupported checkout metadata.",
          );
        await lock(
          creationLock(
            parsed.data.everrOwnerId,
            parsed.data.everrOrganizationName,
          ),
          async () => {
            const intent = await readIntent(db, parsed.data);
            if (intent.polarCustomerId !== data.customerId)
              throw new BillingError(
                "identity_conflict",
                "Subscription belongs to another customer.",
              );
            assertTeam(await polar.getCustomer(data.customerId), orgId);
            if (!data.checkoutId)
              throw new BillingError(
                "identity_conflict",
                "Subscription has no checkout.",
              );
            const source = await polar.checkout(data.checkoutId);
            assertSession(source, orgId, data.customerId);
            assertSubscription(source, data);
            const sourceMetadata = creationMetadata.safeParse(source.metadata);
            if (
              !sourceMetadata.success ||
              JSON.stringify(sourceMetadata.data) !==
                JSON.stringify(parsed.data)
            )
              throw new BillingError(
                "identity_conflict",
                "Subscription checkout metadata does not match.",
              );
            const current = await polar.subscription(data.id);
            assertSubscription(source, current);
            if (
              data.status === "active" &&
              (current.status !== "active" || source.status !== "succeeded")
            )
              return;
            if (intent.completedAt) {
              await lock(`billing:${orgId}`, () =>
                store.saveSubscription(orgId, data),
              );
              return;
            }
            if (!current.checkoutId)
              throw new BillingError(
                "identity_conflict",
                "Subscription has no checkout.",
              );
            if (current.status !== "active") return;
            const checkout = await polar.checkout(current.checkoutId);
            await finalize(parsed.data, checkout, createOrganization);
          },
        );
      } else {
        if (data.metadata.orgId !== orgId)
          throw new BillingError(
            "unsupported_checkout",
            "Subscription is missing organization metadata.",
          );
        await lock(`billing:${orgId}`, async () => {
          const customer = await identity.customerForOrganization(orgId);
          if (customer?.id !== data.customerId)
            throw new BillingError(
              "identity_conflict",
              "Subscription does not match organization billing.",
            );
          assertTeam(await polar.getCustomer(data.customerId), orgId);
          const current = await polar.subscription(data.id);
          if (!current.checkoutId)
            throw new BillingError(
              "identity_conflict",
              "Subscription has no checkout.",
            );
          const source = await polar.checkout(current.checkoutId);
          assertSession(source, orgId, data.customerId);
          assertSubscription(source, data);
          assertSubscription(source, current);
          if (
            data.status === "active" &&
            (current.status !== "active" || source.status !== "succeeded")
          )
            return;
          if (source.metadata.orgId !== orgId || source.metadata.everrPurpose)
            throw new BillingError(
              "identity_conflict",
              "Subscription checkout metadata does not match.",
            );
          await store.saveSubscription(orgId, data);
        });
      }
    },
  };
}
