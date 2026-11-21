import type { ApplicationEntry } from "#app/composition/entry.ts";

export const entry: ApplicationEntry = {
  async getEntryState() {
    const { getEntryState } = await import("../entry-state");
    return getEntryState();
  },
  async canOpenSignup(input) {
    const { canOpenSignup } = await import("../signup");
    return canOpenSignup(input);
  },
  async getOrganizationEntryRedirect() {},
};
