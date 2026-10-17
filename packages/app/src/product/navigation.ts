import type { OrganizationPolicy } from "./policy";

export interface ApplicationNavigation {
  ensureStorageReady(metadata: unknown, returnTo: string): void;
  afterOrganizationSelected(
    createdId: string | null | undefined,
    organizationId: string,
    returnTo: string,
  ): void;
  ensureAppAccess(policy: OrganizationPolicy): void;
}
