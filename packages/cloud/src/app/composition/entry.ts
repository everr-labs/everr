import type { ApplicationEntry } from "@everr/app/composition";

export const entry: ApplicationEntry = {
  async canOpenSignup() {
    return true;
  },
  async getOrganizationEntryRedirect(session) {
    const { getOrganizationEntryRedirect } =
      await import("../../organization-provisioning/continuation.server");
    return getOrganizationEntryRedirect(session);
  },
};
