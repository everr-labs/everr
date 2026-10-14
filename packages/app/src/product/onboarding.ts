import type { GenericEndpointContext } from "better-auth";
import type { Database } from "@/db/client";

export type SessionOnboardingHookFactory = (
  createOrganization: (body: {
    name: string;
    slug: string;
    userId: string;
  }) => Promise<{ id: string } | null>,
  database: Database,
  onCreated: (
    session: { id: string; activeOrganizationId: string },
    context: GenericEndpointContext | null,
  ) => Promise<void>,
) => (
  session: { id: string; userId: string; activeOrganizationId?: string | null },
  context?: GenericEndpointContext | null,
) => Promise<void>;
