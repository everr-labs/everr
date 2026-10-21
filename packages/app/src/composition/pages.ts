import type { QueryClient } from "@tanstack/react-query";
import type { ComponentType } from "react";

export interface OrganizationPageProps {
  organizationId: string;
}

/** Page loading runs inside the application's existing access guards. */
export interface OrganizationPage {
  component: ComponentType<OrganizationPageProps>;
  load?: (context: OrganizationPageProps & { queryClient: QueryClient }) => Promise<void>;
}

export interface AccountPageProps {
  googleSignInEnabled: boolean;
}

export interface ApplicationPages {
  account: ComponentType<AccountPageProps>;
  members: OrganizationPage;
}
