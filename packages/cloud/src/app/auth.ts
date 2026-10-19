import type { ApplicationIdentity } from "@everr/app/composition";
import { billingIdentityAdapter } from "../billing/auth-adapter.server";
import { billingAuthPlugin } from "../billing/auth-plugin.server";
import { withBillingRequest } from "../billing/lock.server";
import {
  billingMembershipPlugin,
  billingOrganizationHooks,
} from "../billing/membership-plugin.server";
import { beforeCreateCheckoutOrganization } from "../billing/organization-context.server";
import { billing } from "../billing/server";
import { organizationLifecycleAdapter } from "../organization-provisioning/adapter.server";
import { waitForOrganizationProvisioning } from "../organization-provisioning/fast-path";
import { parseOrganizationMetadata } from "../organization-provisioning/metadata";
import { beforeUserCreate, createSessionOnboardingHook } from "./onboarding";

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

export const identity = {
  withIdentityRequest: withBillingRequest,
  beforeUserCreate,
  createSessionOnboardingHook,
  identityAdapter: () => billingIdentityAdapter(organizationLifecycleAdapter()),
  organizationHooks: () => ({
    beforeCreateOrganization: beforeCreateCheckoutOrganization,
    ...billingOrganizationHooks(),
    afterCreateOrganization,
  }),
  identityLifecycle: billing,
  authPlugins: (createOrganization) => [billingAuthPlugin(createOrganization)],
  membershipPlugin: billingMembershipPlugin(),
} satisfies ApplicationIdentity;
