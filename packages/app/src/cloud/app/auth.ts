import type { BetterAuthPlugin } from "better-auth";
import { billingIdentityAdapter } from "@/cloud/billing/auth-adapter.server";
import { billingAuthPlugin } from "@/cloud/billing/auth-plugin.server";
import {
  billingMembershipPlugin,
  billingOrganizationHooks,
} from "@/cloud/billing/membership-plugin.server";
import { beforeCreateCheckoutOrganization } from "@/cloud/billing/organization-context.server";
import type { CreateOrganization } from "@/cloud/billing/types";
import { organizationLifecycleAdapter } from "@/cloud/organization-provisioning/adapter.server";
import { waitForOrganizationProvisioning } from "@/cloud/organization-provisioning/fast-path";
import { parseOrganizationMetadata } from "@/cloud/organization-provisioning/metadata";
export const identityAdapter = () =>
  billingIdentityAdapter(organizationLifecycleAdapter());
async function afterCreateOrganization({
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

export const organizationHooks = () => ({
  beforeCreateOrganization: beforeCreateCheckoutOrganization,
  ...billingOrganizationHooks(),
  afterCreateOrganization,
});
export { billing as identityLifecycle } from "@/cloud/billing/server";
export function authPlugins(
  createOrganization: CreateOrganization,
): BetterAuthPlugin[] {
  return [billingAuthPlugin(createOrganization)];
}

export const membershipPlugins = [billingMembershipPlugin()] as const;
