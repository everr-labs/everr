import type { ApplicationIdentity } from "@everr/app/composition";
import { billingIdentityAdapter } from "../../billing/auth-adapter.server";
import { billingAuthPlugin } from "../../billing/auth-plugin.server";
import {
  lockAccountDeletion,
  lockUserLifecycle,
  withBillingRequest,
} from "../../billing/lock.server";
import { beforeCreateCheckoutOrganization } from "../../billing/organization-context.server";
import { organizationLifecycleAdapter } from "../../organization-provisioning/adapter.server";
import { waitForOrganizationProvisioning } from "../../organization-provisioning/fast-path";
import { parseOrganizationMetadata } from "../../organization-provisioning/metadata";
import { identityPolicy } from "../identity-policy.server";
import { createSessionOnboardingHook } from "../onboarding";

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
  policy: identityPolicy,
  provider: {
    withIdentityRequest: withBillingRequest,
    lockAccountDeletion,
    lockUserLifecycle,
    createSessionOnboardingHook,
    identityAdapter: (executor) => billingIdentityAdapter(organizationLifecycleAdapter(executor)),
    organizationHooks: () => ({
      beforeCreateOrganization: beforeCreateCheckoutOrganization,
      afterCreateOrganization,
    }),
    authPlugins: (createOrganization) => [billingAuthPlugin(createOrganization)],
  },
} satisfies ApplicationIdentity;
