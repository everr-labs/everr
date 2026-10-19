import type { OrganizationPolicy } from "./policy";

export interface ApplicationNavigation {
  ensureStorageReady(metadata: unknown, returnTo: string): void;
  ensureAppAccess(policy: OrganizationPolicy): void;
}
