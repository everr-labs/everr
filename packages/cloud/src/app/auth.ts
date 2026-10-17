import type { BetterAuthPlugin } from "better-auth";
import { billingIdentityAdapter } from "../billing/auth-adapter.server";
import { billingAuthPlugin } from "../billing/auth-plugin.server";
import {
  billingMembershipPlugin,
  billingOrganizationHooks,
} from "../billing/membership-plugin.server";
import { beforeCreateCheckoutOrganization } from "../billing/organization-context.server";
import type { CreateOrganization } from "../billing/types";
import { organizationLifecycleAdapter } from "../organization-provisioning/adapter.server";
import { waitForOrganizationProvisioning } from "../organization-provisioning/fast-path";
import { parseOrganizationMetadata } from "../organization-provisioning/metadata";
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
export { billing as identityLifecycle } from "../billing/server";
export function authPlugins(
  createOrganization: CreateOrganization,
): BetterAuthPlugin[] {
  return [billingAuthPlugin(createOrganization)];
}

export const membershipPlugins = [billingMembershipPlugin()] as const;
