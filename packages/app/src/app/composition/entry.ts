import type { ApplicationEntry } from "#app/composition/entry.ts";

export const entry: ApplicationEntry = {
  async getEntryRedirect(pathname) {
    const { getEntryRedirect } = await import("../entry");
    return getEntryRedirect(pathname);
  },
  async canOpenSignup(input) {
    const { canOpenSignup } = await import("../signup");
    return canOpenSignup(input);
  },
  async getOrganizationEntryRedirect() {},
};
