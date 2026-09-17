import { generateId } from "better-auth";
import { and, eq, isNull } from "drizzle-orm";
import { proOrganizationCheckout } from "@/db/schema";
import { generateOrgSlug } from "@/lib/auto-org";
import { creationLock, metadataFor } from "./attempts";
import type { createBillingIdentity } from "./identity";
import { creationMetadata } from "./metadata";
import type { BillingStore } from "./store";
import { type BillingDependencies, BillingError, type Checkout } from "./types";
import { assertSession, verifyPayment } from "./verification";
export function createBillingCheckouts(
  deps: BillingDependencies,
  store: BillingStore,
  identity: ReturnType<typeof createBillingIdentity>,
) {
  const { db, polar, lock } = deps;
  const successUrl = (fresh: boolean) =>
    new URL(
      `${fresh ? "/organizations" : ""}/checkout/success?checkout_id={CHECKOUT_ID}`,
      deps.appUrl,
    ).toString();
  return {
    async startNew(ownerId: string, name: string) {
      name = name.trim();
      return lock(creationLock(ownerId, name), async () => {
        let [intent] = await db
          .select()
          .from(proOrganizationCheckout)
          .where(
            and(
              eq(proOrganizationCheckout.ownerId, ownerId),
              eq(proOrganizationCheckout.organizationName, name),
              isNull(proOrganizationCheckout.completedAt),
            ),
          );
        if (!intent)
          [intent] = await db
            .insert(proOrganizationCheckout)
            .values({
              orgId: generateId(),
              ownerId,
              organizationName: name,
              organizationSlug: generateOrgSlug(),
            })
            .returning();
        const customer = await identity.team(
          intent.orgId,
          name,
          await store.person(ownerId),
          intent.polarCustomerId,
        );
        await db
          .update(proOrganizationCheckout)
          .set({ polarCustomerId: customer.id })
          .where(eq(proOrganizationCheckout.orgId, intent.orgId));
        const metadata = metadataFor(intent);
        // Every session is customer-bound; the provider can filter safely.
        const sessions = await polar.checkouts(customer.id);
        const candidates = sessions.filter(
          (s) => s.metadata.everrPurpose === "create_pro_organization",
        );
        for (const session of candidates) {
          assertSession(session, intent.orgId, customer.id);
          const parsed = creationMetadata.safeParse(session.metadata);
          if (
            !parsed.success ||
            JSON.stringify(parsed.data) !== JSON.stringify(metadata)
          )
            throw new BillingError(
              "unsupported_checkout",
              "An incompatible checkout exists for this organization.",
            );
        }
        let checkout = ["succeeded", "confirmed", "open"].flatMap((status) =>
          candidates.filter(
            (s) =>
              s.status === status &&
              (status !== "open" || s.expiresAt.getTime() > Date.now()),
          ),
        )[0];
        if (!checkout)
          checkout = await polar.createCheckout({
            customerId: customer.id,
            orgId: intent.orgId,
            metadata,
            successUrl: successUrl(true),
          });
        await db
          .update(proOrganizationCheckout)
          .set({ checkoutId: checkout.id })
          .where(eq(proOrganizationCheckout.orgId, intent.orgId));
        return {
          kind: "checkout" as const,
          url:
            checkout.status === "open"
              ? checkout.url
              : new URL(
                  `/organizations/checkout/success?checkout_id=${encodeURIComponent(checkout.id)}`,
                  deps.appUrl,
                ).toString(),
        };
      });
    },
    async startUpgrade(orgId: string, actorId: string) {
      return lock(`billing:${orgId}`, async () => {
        const customer = await identity.prepareCheckout(orgId, actorId);
        const sessions = (await polar.checkouts(customer.id)).filter(
          (s) => s.metadata.orgId === orgId && !s.metadata.everrPurpose,
        );
        for (const session of sessions)
          assertSession(session, orgId, customer.id);
        // A paid checkout can precede its webhook. Never sell a second active
        // subscription while the first payment is still being finalized.
        let paid: Checkout | undefined;
        for (const session of sessions.filter(
          (s) => s.status === "succeeded",
        )) {
          if (await verifyPayment(polar, session, orgId, customer.id)) {
            paid = session;
            break;
          }
        }
        const checkout =
          paid ??
          sessions.find((s) => s.status === "confirmed") ??
          sessions.find(
            (s) => s.status === "open" && s.expiresAt.getTime() > Date.now(),
          ) ??
          (await polar.createCheckout({
            customerId: customer.id,
            orgId,
            metadata: { orgId, userId: actorId },
            successUrl: successUrl(false),
          }));
        return {
          url:
            checkout.status === "open"
              ? checkout.url
              : new URL(
                  `/checkout/success?checkout_id=${encodeURIComponent(checkout.id)}`,
                  deps.appUrl,
                ).toString(),
        };
      });
    },
  };
}
