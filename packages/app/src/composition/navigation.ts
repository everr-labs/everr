import type { OrganizationPolicy } from "./policy";

export interface ApplicationNavigation {
  ensureStorageReady(this: void, metadata: unknown, returnTo: string): void;
  ensureAppAccess(policy: OrganizationPolicy): void;
}
