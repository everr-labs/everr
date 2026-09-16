import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { member, organization, proOrganizationCheckout } from "@/db/schema";
import {
  assertPolarProductGrantsPlan,
  planForPolarProductId,
} from "@/lib/billing-catalog.server";
import {
  setOrganizationPlan,
  upsertOrgSubscription,
} from "@/lib/billing-data.server";
import {
  organizationCheckoutLockKey,
  withCheckoutLock,
} from "@/lib/checkout-lock.server";
import { provisionSqlApiOrgUser } from "@/lib/clickhouse";
import { withOrganizationCreationId } from "@/lib/organization-creation-context.server";
import { isOrganizationOwner } from "@/lib/organization-role";
import {
  getPolarCustomerForOrg,
  linkPolarCustomerToOrg,
  polarClient,
} from "@/lib/polar.server";
import {
  type ProOrganizationCheckoutMetadata,
  ProOrganizationCheckoutMetadataSchema,
} from "@/lib/pro-organization-checkout";
import { readCheckoutIntent } from "@/lib/pro-organization-checkout.server";
import { serverLogger } from "@/telemetry/logger";

type Subscription = {
  id: string;
  status: string;
  productId: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  modifiedAt: Date | null;
  createdAt: Date;
};
type PolarSubscriptionPayload = Subscription & {
  metadata: Record<string, string | number | boolean>;
  customer: { id: string; externalId?: string | null };
};

async function findCheckoutOrganization(
  metadata: ProOrganizationCheckoutMetadata,
) {
  const [existing] = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      ownerRole: member.role,
      plan: organization.plan,
    })
    .from(organization)
    .leftJoin(
      member,
      and(
        eq(member.organizationId, organization.id),
        eq(member.userId, metadata.everrOwnerId),
      ),
    )
    .where(
      metadata.everrSchemaVersion === 2
        ? eq(organization.id, metadata.everrOrganizationId)
        : eq(organization.slug, metadata.everrOrganizationSlug),
    )
    .limit(1);
  return existing;
}

async function saveSubscription(orgId: string, subscription: Subscription) {
  const updated = await upsertOrgSubscription({
    orgId,
    polarSubscriptionId: subscription.id,
    polarProductId: subscription.productId,
    status: subscription.status,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    polarModifiedAt: subscription.modifiedAt ?? subscription.createdAt,
  });
  if (updated && subscription.status === "active")
    await setOrganizationPlan(
      orgId,
      planForPolarProductId(subscription.productId),
    );
}

type FinalizationInput = {
  metadata: ProOrganizationCheckoutMetadata;
  customerId: string;
  subscription: Subscription;
};

export function createProOrganizationFinalizer(
  createOrganization: (input: {
    body: { name: string; slug: string; userId: string; plan: "pro" };
  }) => Promise<unknown>,
) {
  async function finalizeProOrganizationCheckout(input: FinalizationInput) {
    return withCheckoutLock(
      organizationCheckoutLockKey(
        input.metadata.everrOwnerId,
        input.metadata.everrOrganizationName,
      ),
      () => finalizeCheckout(input),
    );
  }

  async function finalizeCheckout(input: FinalizationInput) {
    const { metadata, subscription } = input;
    if (subscription.status !== "active")
      throw new Error("An active Pro subscription is required");
    assertPolarProductGrantsPlan(subscription.productId, "pro");
    const intent =
      metadata.everrSchemaVersion === 2
        ? await readCheckoutIntent(metadata)
        : null;
    const customer = await polarClient.customers.get({ id: input.customerId });
    if (
      metadata.everrSchemaVersion === 2 &&
      customer.externalId !== metadata.everrOrganizationId
    ) {
      throw new Error(
        "Polar customer does not match the checkout organization",
      );
    }
    let existing = await findCheckoutOrganization(metadata);
    if (
      metadata.everrSchemaVersion === 1 &&
      customer.externalId &&
      customer.externalId !== existing?.id
    ) {
      throw new Error(
        "Polar customer is already linked to another organization",
      );
    }
    if (!existing) {
      if (intent?.completedAt)
        throw new Error("The checkout organization no longer exists");
      const create = () =>
        createOrganization({
          body: {
            name: metadata.everrOrganizationName,
            slug: metadata.everrOrganizationSlug,
            userId: metadata.everrOwnerId,
            plan: "pro",
          },
        });
      const created =
        metadata.everrSchemaVersion === 2
          ? await withOrganizationCreationId(
              {
                id: metadata.everrOrganizationId,
                slug: metadata.everrOrganizationSlug,
                ownerId: metadata.everrOwnerId,
              },
              create,
            )
          : await create();
      if (!created) throw new Error("Organization creation failed");
      existing = await findCheckoutOrganization(metadata);
    }
    if (
      !existing ||
      (intent &&
        !intent.completedAt &&
        (existing.slug !== intent.organizationSlug ||
          existing.name !== intent.organizationName))
    ) {
      throw new Error("The checkout organization does not match its metadata");
    }
    if (!existing.ownerRole && intent && !intent.completedAt) {
      // Better Auth may have inserted the org before member creation failed.
      // Only a verified, unfinished server-owned intent can repair this state.
      const members = await db
        .select({ id: member.id })
        .from(member)
        .where(eq(member.organizationId, existing.id))
        .limit(1);
      if (members.length)
        throw new Error("The checkout organization already has members");
      await db.insert(member).values({
        id: randomUUID(),
        organizationId: existing.id,
        userId: metadata.everrOwnerId,
        role: "owner",
        createdAt: new Date(),
      });
      existing.ownerRole = "owner";
    }
    if (!isOrganizationOwner(existing.ownerRole))
      throw new Error("The checkout organization does not match its owner");
    if (intent && !intent.completedAt)
      await provisionSqlApiOrgUser(existing.id);
    if (metadata.everrSchemaVersion === 1 && !customer.externalId) {
      try {
        await linkPolarCustomerToOrg({
          customerId: input.customerId,
          orgId: existing.id,
        });
      } catch (error) {
        if (
          (await getPolarCustomerForOrg(existing.id))?.id !== input.customerId
        )
          throw error;
      }
    }
    await saveSubscription(existing.id, subscription);
    if (intent && !intent.completedAt) {
      await db
        .update(proOrganizationCheckout)
        .set({ completedAt: new Date() })
        .where(eq(proOrganizationCheckout.orgId, intent.orgId));
    }
    return {
      status: "completed" as const,
      organization: { id: existing.id, name: existing.name },
    };
  }

  async function syncSubscription({
    data,
  }: {
    data: PolarSubscriptionPayload;
  }) {
    const orgId = data.customer.externalId;
    // Upgrade metadata is server-owned. An email match in Polar must never
    // redirect the subscription to another organization's customer.
    if (
      typeof data.metadata.orgId === "string" &&
      data.metadata.orgId !== orgId
    ) {
      throw new Error(
        "Subscription customer does not match its checkout organization",
      );
    }
    const parsed = ProOrganizationCheckoutMetadataSchema.safeParse(
      data.metadata,
    );
    if (parsed.success && (parsed.data.everrSchemaVersion === 2 || !orgId)) {
      const metadata = parsed.data;
      return withCheckoutLock(
        organizationCheckoutLockKey(
          metadata.everrOwnerId,
          metadata.everrOrganizationName,
        ),
        async () => {
          if (metadata.everrSchemaVersion === 2) {
            if (orgId !== metadata.everrOrganizationId)
              throw new Error(
                "Subscription customer does not match its organization",
              );
            const intent = await readCheckoutIntent(metadata);
            if (intent.completedAt) {
              await saveSubscription(orgId, data);
              return;
            }
          }
          // Read current state under the same lock as callback finalization. A
          // concurrent cancellation must retry, never be dropped before org creation.
          const current = await polarClient.subscriptions.get({ id: data.id });
          if (current.status !== "active") return;
          if (current.customerId !== data.customer.id)
            throw new Error("Subscription customer mismatch");
          await finalizeCheckout({
            metadata,
            customerId: data.customer.id,
            subscription: current,
          });
        },
      );
    }
    if (!orgId) {
      serverLogger.warn("polar.webhook.subscription_missing_external_id", {
        "polar.subscription.id": data.id,
      });
      return;
    }
    await saveSubscription(orgId, data);
  }

  return { finalizeProOrganizationCheckout, syncSubscription };
}
