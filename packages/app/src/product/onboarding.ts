import type { GenericEndpointContext } from "better-auth";

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
