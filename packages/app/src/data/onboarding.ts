import { createServerFn } from "@tanstack/react-start";
import {
  getAuth,
  switchToOrganization,
} from "@workos/authkit-tanstack-react-start";
import { CreateOrganizationInputSchema } from "@/common/organization-name";
import {
  ensureTenantForOrganizationId,
  getGithubInstallationsForTenant,
} from "@/data/tenants";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { workOS } from "@/lib/workos";

export type OnboardingErrorCode =
  | "UNAUTHENTICATED"
  | "ORG_CREATE_FAILED"
  | "MEMBERSHIP_CREATE_FAILED"
  | "SESSION_SWITCH_FAILED"
  | "TENANT_LINK_FAILED";

function createSafeOnboardingError(
  code: OnboardingErrorCode,
  requestId: string,
): Error {
  switch (code) {
    case "UNAUTHENTICATED":
      return new Error("You need to sign in before creating an organization.");
    case "ORG_CREATE_FAILED":
      return new Error(
        `We couldn't create your organization right now. Please try again. (ref: ${requestId})`,
      );
    case "MEMBERSHIP_CREATE_FAILED":
      return new Error(
        `Your organization was created, but we couldn't finish setup. Please try again. (ref: ${requestId})`,
      );
    case "SESSION_SWITCH_FAILED":
      return new Error(
        `Your organization was created, but we couldn't switch your session. Please try again. (ref: ${requestId})`,
      );
    case "TENANT_LINK_FAILED":
      return new Error(
        `Your organization is ready, but we couldn't finish tenant setup. Please try again. (ref: ${requestId})`,
      );
  }
}

export const createOrganizationForCurrentUser = createServerFn({
  method: "POST",
})
  .inputValidator(CreateOrganizationInputSchema)
  .handler(async ({ data }) => {
    const requestId = crypto.randomUUID();

    const auth = await getAuth();
    if (!auth.user) {
      throw createSafeOnboardingError("UNAUTHENTICATED", requestId);
    }

    if (auth.organizationId) {
      try {
        await ensureTenantForOrganizationId(auth.organizationId);
      } catch (error) {
        console.error("[onboarding] tenant_link_failed_existing_org", {
          requestId,
          userId: auth.user.id,
          organizationId: auth.organizationId,
          error,
        });
        throw createSafeOnboardingError("TENANT_LINK_FAILED", requestId);
      }

      return {
        organizationId: auth.organizationId,
        organizationName: data.organizationName,
      };
    }

    let organizationId: string;

    try {
      const organization = await workOS.organizations.createOrganization({
        name: data.organizationName,
      });
      organizationId = organization.id;
    } catch (error) {
      console.error("[onboarding] org_create_failed", {
        requestId,
        userId: auth.user.id,
        organizationName: data.organizationName,
        error,
      });
      throw createSafeOnboardingError("ORG_CREATE_FAILED", requestId);
    }

    try {
      await workOS.userManagement.createOrganizationMembership({
        organizationId,
        userId: auth.user.id,
        roleSlug: "admin",
      });
    } catch (error) {
      console.error("[onboarding] membership_create_failed", {
        requestId,
        userId: auth.user.id,
        organizationId,
        error,
      });
      throw createSafeOnboardingError("MEMBERSHIP_CREATE_FAILED", requestId);
    }

    try {
      await switchToOrganization({
        data: { organizationId },
      });
    } catch (error) {
      console.error("[onboarding] session_switch_failed", {
        requestId,
        userId: auth.user.id,
        organizationId,
        error,
      });
      throw createSafeOnboardingError("SESSION_SWITCH_FAILED", requestId);
    }

    try {
      await ensureTenantForOrganizationId(organizationId);
    } catch (error) {
      console.error("[onboarding] tenant_link_failed_new_org", {
        requestId,
        userId: auth.user.id,
        organizationId,
        error,
      });
      throw createSafeOnboardingError("TENANT_LINK_FAILED", requestId);
    }

    return {
      organizationId,
      organizationName: data.organizationName,
    };
  });

export const getGithubAppInstallStatus = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context: { auth } }) => {
  const tenantId = await ensureTenantForOrganizationId(auth.organizationId);
  const installations = await getGithubInstallationsForTenant(tenantId);

  return installations.map((installation) => ({
    installed: installation.status === "active",
    installationId: installation.installationId,
    installedAt: installation.createdAt,
    status: installation.status,
  }));
});
