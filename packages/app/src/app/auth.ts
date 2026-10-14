import type { BetterAuthPlugin } from "better-auth";
import type { drizzleAdapter } from "better-auth/adapters/drizzle";

export const identityAdapter = (adapter: ReturnType<typeof drizzleAdapter>) =>
  adapter;
export const organizationHooks = () => ({});
export const beforeCreateOrganization = async () => undefined;

export const identityLifecycle = {
  async beforeUserDelete(_userId: string) {},
  async beforeMembershipChange(
    _orgId: string,
    _userId: string,
    _role: string | null,
  ) {},
  async assertDeletable(_orgId: string) {},
};
export function authPlugins(_createOrganization: unknown): BetterAuthPlugin[] {
  return [];
}

export const membershipPlugins = [] as const;
