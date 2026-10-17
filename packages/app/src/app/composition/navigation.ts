import type { ApplicationNavigation } from "@/product/navigation";
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
