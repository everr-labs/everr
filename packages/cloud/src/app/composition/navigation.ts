import type { ApplicationNavigation } from "@everr/app/composition";
import { redirect } from "@tanstack/react-router";
import { ensureStorageReady } from "../storage-readiness";
export const navigation: ApplicationNavigation = {
  ensureStorageReady,
  ensureAppAccess(policy) {
    if (policy.access === "suspended")
      throw redirect({ to: "/billing/suspended", replace: true });
  },
};
