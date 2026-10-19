import type { GenericEndpointContext } from "better-auth";

/**
 * The post-session onboarding extension: application-specific organization
 * creation or selection, with access to the shared organization-creation flow.
 */
export type SessionOnboardingHookFactory = (
  createOrganization: (body: {
    name: string;
    slug: string;
    userId: string;
  }) => Promise<{ id: string } | null>,
) => (
  session: { id: string; userId: string; activeOrganizationId?: string | null },
  context?: GenericEndpointContext | null,
) => Promise<void>;
