import { createServerFn } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { z } from "zod";
import { getWorkOS } from "@/lib/workos";

export const CreateOrganizationInputSchema = z.object({
  organizationName: z
    .string()
    .trim()
    .min(2, "Organization name must be at least 2 characters")
    .max(100, "Organization name must be at most 100 characters"),
});

export type CreateOrganizationInput = z.infer<
  typeof CreateOrganizationInputSchema
>;

export type OnboardingErrorCode =
  | "UNAUTHENTICATED"
  | "ORG_CREATE_FAILED"
  | "MEMBERSHIP_CREATE_FAILED";

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
      return {
        organizationId: auth.organizationId,
        organizationName: data.organizationName,
      };
    }

    const workos = getWorkOS();

    let organizationId: string;

    try {
      const organization = await workos.organizations.createOrganization({
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
      await workos.userManagement.createOrganizationMembership({
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

    return {
      organizationId,
      organizationName: data.organizationName,
    };
  });
