import type { QueryClient } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { OrganizationMembersPage } from "#app/components/users-management/members-page.tsx";

export interface OrganizationPageProps {
  organizationId: string;
}

/** Page loading runs inside the application's existing access guards. */
export interface OrganizationPage {
  component: ComponentType<OrganizationPageProps>;
  load?: (
    context: OrganizationPageProps & { queryClient: QueryClient },
  ) => Promise<void>;
}

export interface ApplicationPages {
  members: OrganizationPage;
}

export const pages: ApplicationPages = {
  members: { component: OrganizationMembersPage },
};
