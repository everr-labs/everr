import type { ApplicationNavigation } from "#app/product/navigation.ts";
import {
  afterOrganizationSelected,
  ensureStorageReady,
} from "../storage-readiness";
export const navigation: ApplicationNavigation = {
  ensureStorageReady,
  afterOrganizationSelected,
  ensureAppAccess(policy) {
    void policy;
  },
};
