import type { BetterAuthPlugin } from "better-auth";
import { billingAuthPlugin } from "@/cloud/billing/auth-plugin.server";
import { billingMembershipPlugin } from "@/cloud/billing/membership-plugin.server";
import type { CreateOrganization } from "@/cloud/billing/types";

export { billingIdentityAdapter as identityAdapter } from "@/cloud/billing/auth-adapter.server";

export { billingOrganizationHooks as organizationHooks } from "@/cloud/billing/membership-plugin.server";
export { beforeCreateCheckoutOrganization as beforeCreateOrganization } from "@/cloud/billing/organization-context.server";
export { billing as identityLifecycle } from "@/cloud/billing/server";
export function authPlugins(
  createOrganization: CreateOrganization,
): BetterAuthPlugin[] {
  return [billingAuthPlugin(createOrganization)];
}

export const membershipPlugins = [billingMembershipPlugin()] as const;
