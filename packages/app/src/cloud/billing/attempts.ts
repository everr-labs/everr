import { eq } from "drizzle-orm";
import { proOrganizationCheckout } from "@/db/schema";
import type { CreationMetadata } from "./metadata";
import { type BillingDependencies, BillingError } from "./types";

type Intent = typeof proOrganizationCheckout.$inferSelect;
export function metadataFor(intent: Intent): CreationMetadata {
  return {
    everrPurpose: "create_pro_organization",
    everrSchemaVersion: 2,
    everrOrganizationId: intent.orgId,
    everrOwnerId: intent.ownerId,
    everrOrganizationName: intent.organizationName,
    everrOrganizationSlug: intent.organizationSlug,
  };
}
export const creationLock = (ownerId: string, name: string) =>
  JSON.stringify(["pro-organization-checkout", ownerId, name]);
export async function readIntent(
  db: BillingDependencies["db"],
  metadata: CreationMetadata,
) {
  const [intent] = await db
    .select()
    .from(proOrganizationCheckout)
    .where(eq(proOrganizationCheckout.orgId, metadata.everrOrganizationId));
  if (
    !intent ||
    intent.ownerId !== metadata.everrOwnerId ||
    intent.organizationName !== metadata.everrOrganizationName ||
    intent.organizationSlug !== metadata.everrOrganizationSlug
  )
    throw new BillingError(
      "identity_conflict",
      "Checkout does not match its creation request.",
    );
  return intent;
}
