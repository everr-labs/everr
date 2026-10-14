import type { BetterAuthPlugin } from "better-auth";
import { billingIdentityAdapter } from "@/cloud/billing/auth-adapter.server";
import { billingAuthPlugin } from "@/cloud/billing/auth-plugin.server";
import { billingMembershipPlugin } from "@/cloud/billing/membership-plugin.server";
import type { CreateOrganization } from "@/cloud/billing/types";
import { organizationLifecycleAdapter } from "@/cloud/organization-provisioning/adapter.server";
import { waitForOrganizationProvisioning } from "@/cloud/organization-provisioning/fast-path";
import { parseOrganizationMetadata } from "@/cloud/organization-provisioning/metadata";
export const identityAdapter = () =>
  billingIdentityAdapter(organizationLifecycleAdapter());
export async function afterCreateOrganization({
  organization,
}: {
  organization: { id: string; metadata?: unknown };
}) {
  if (await waitForOrganizationProvisioning(organization.id)) {
    Object.assign(organization, {
      metadata: {
        ...parseOrganizationMetadata(organization.metadata),
        clickhouseReady: true,
      },
    });
  }
}

export { billingOrganizationHooks as organizationHooks } from "@/cloud/billing/membership-plugin.server";
export { beforeCreateCheckoutOrganization as beforeCreateOrganization } from "@/cloud/billing/organization-context.server";
export { billing as identityLifecycle } from "@/cloud/billing/server";
export function authPlugins(
  createOrganization: CreateOrganization,
): BetterAuthPlugin[] {
  return [billingAuthPlugin(createOrganization)];
}

export const membershipPlugins = [billingMembershipPlugin()] as const;
