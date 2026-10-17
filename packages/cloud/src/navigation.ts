import type { ApplicationNavigation } from "@everr/app/product/navigation";
import { redirect } from "@tanstack/react-router";
import {
  afterOrganizationSelected,
  ensureStorageReady,
} from "./app/storage-readiness";
export const navigation: ApplicationNavigation = {
  ensureStorageReady,
  afterOrganizationSelected,
  ensureAppAccess(policy) {
    if (policy.access === "suspended")
      throw redirect({ to: "/billing/suspended", replace: true });
  },
};
