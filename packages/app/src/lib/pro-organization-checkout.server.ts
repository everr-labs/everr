import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { proOrganizationCheckout } from "@/db/schema";
import { env } from "@/env";
import { generateOrgSlug } from "@/lib/auto-org";
import { polarProductIdForPlan } from "@/lib/billing-catalog.server";
import {
  organizationCheckoutLockKey,
  withCheckoutLock,
} from "@/lib/checkout-lock.server";
import { polarClient } from "@/lib/polar.server";
import {
  ensurePolarTeamCustomer,
  readBillingPerson,
} from "@/lib/polar-team.server";
import {
  ProOrganizationCheckoutMetadataSchema,
  type ProOrganizationCheckoutMetadataV2,
} from "@/lib/pro-organization-checkout";

type Intent = typeof proOrganizationCheckout.$inferSelect;

export function checkoutIntentMetadata(
  intent: Intent,
): ProOrganizationCheckoutMetadataV2 {
  return {
    everrPurpose: "create_pro_organization",
    everrOwnerId: intent.ownerId,
    everrOrganizationName: intent.organizationName,
    everrOrganizationSlug: intent.organizationSlug,
    everrOrganizationId: intent.orgId,
    everrSchemaVersion: 2,
  };
}

export async function readCheckoutIntent(
  metadata: ProOrganizationCheckoutMetadataV2,
) {
  const [intent] = await db
    .select()
    .from(proOrganizationCheckout)
    .where(eq(proOrganizationCheckout.orgId, metadata.everrOrganizationId))
    .limit(1);
  if (
    !intent ||
    intent.ownerId !== metadata.everrOwnerId ||
    intent.organizationName !== metadata.everrOrganizationName ||
    intent.organizationSlug !== metadata.everrOrganizationSlug
  ) {
    throw new Error(
      "Checkout does not match its organization creation request",
    );
  }
  return intent;
}

async function reserveIntent(ownerId: string, organizationName: string) {
  const [existing] = await db
    .select()
    .from(proOrganizationCheckout)
    .where(
      and(
        eq(proOrganizationCheckout.ownerId, ownerId),
        eq(proOrganizationCheckout.organizationName, organizationName),
        isNull(proOrganizationCheckout.completedAt),
      ),
    )
    .limit(1);
  if (existing) return { intent: existing, created: false };
  const [intent] = await db
    .insert(proOrganizationCheckout)
    .values({
      orgId: randomUUID(),
      ownerId,
      organizationName,
      organizationSlug: generateOrgSlug(),
    })
    .returning();
  return { intent, created: true };
}

export async function startProOrganizationCheckout(
  ownerId: string,
  organizationName: string,
) {
  return withCheckoutLock(
    organizationCheckoutLockKey(ownerId, organizationName),
    async () => {
      const { intent, created } = await reserveIntent(
        ownerId,
        organizationName,
      );
      const metadata = checkoutIntentMetadata(intent);
      const sessions: Awaited<ReturnType<typeof polarClient.checkouts.get>>[] =
        [];
      if (intent.checkoutId) {
        const known = await polarClient.checkouts.get({
          id: intent.checkoutId,
        });
        if (
          known.status === "succeeded" ||
          known.status === "confirmed" ||
          (known.status === "open" && known.expiresAt.getTime() > Date.now())
        )
          sessions.push(known);
      }
      if (!created && sessions.length === 0) {
        // Polar's externalCustomerId list filter joins the customer table, so it
        // excludes unpaid checkouts that do not have a customer yet. Reconcile
        // uncertain/expired attempts against the checkout's own external ID.
        const pages = await polarClient.checkouts.list({
          limit: 100,
          sorting: ["-created_at"],
        });
        for await (const page of pages) {
          sessions.push(
            ...page.result.items.filter(
              (session) => session.externalCustomerId === intent.orgId,
            ),
          );
        }
      }
      for (const session of sessions) {
        const parsed = ProOrganizationCheckoutMetadataSchema.safeParse(
          session.metadata,
        );
        if (
          session.externalCustomerId !== intent.orgId ||
          !parsed.success ||
          parsed.data.everrSchemaVersion !== 2 ||
          parsed.data.everrOrganizationId !== intent.orgId ||
          parsed.data.everrOwnerId !== ownerId ||
          parsed.data.everrOrganizationName !== organizationName ||
          parsed.data.everrOrganizationSlug !== intent.organizationSlug
        ) {
          throw new Error(
            "Checkout does not match its organization creation request",
          );
        }
      }
      let checkout = ["succeeded", "confirmed", "open"].flatMap((status) =>
        sessions.filter(
          (session) =>
            session.status === status &&
            (status !== "open" ||
              (session.customerId != null &&
                session.expiresAt.getTime() > Date.now())),
        ),
      )[0];
      if (!checkout || checkout.status === "open") {
        const customer = await ensurePolarTeamCustomer({
          orgId: intent.orgId,
          name: intent.organizationName,
          owner: await readBillingPerson(ownerId),
        });
        if (checkout && checkout.customerId !== customer.id) {
          throw new Error("Checkout customer does not match this organization");
        }
        if (!checkout) {
          checkout = await polarClient.checkouts.create({
            customerId: customer.id,
            products: [polarProductIdForPlan("pro")],
            externalCustomerId: intent.orgId,
            allowTrial: false,
            metadata,
            successUrl: new URL(
              "/organizations/checkout/success?checkout_id={CHECKOUT_ID}",
              env.BETTER_AUTH_URL,
            ).toString(),
            returnUrl: new URL("/", env.BETTER_AUTH_URL).toString(),
          });
        }
      }
      await db
        .update(proOrganizationCheckout)
        .set({ checkoutId: checkout.id })
        .where(eq(proOrganizationCheckout.orgId, intent.orgId));
      if (checkout.status === "open")
        return { kind: "checkout" as const, url: checkout.url };
      const url = new URL(
        "/organizations/checkout/success",
        env.BETTER_AUTH_URL,
      );
      url.searchParams.set("checkout_id", checkout.id);
      return { kind: "checkout" as const, url: url.toString() };
    },
  );
}
