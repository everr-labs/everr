import type { BetterAuthPlugin } from "better-auth";
import type { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { OrganizationOptions } from "better-auth/plugins/organization";
import type { SessionOnboardingHookFactory } from "./onboarding";

/** Organization creation extensions. Membership and deletion hooks are shared-owned. */
type OrganizationHooks = NonNullable<OrganizationOptions["organizationHooks"]>;
type CreationHook = "beforeCreateOrganization" | "afterCreateOrganization";
type ApplicationOrganizationHooks = Pick<OrganizationHooks, CreationHook> & {
  [Hook in Exclude<keyof OrganizationHooks, CreationHook>]?: never;
};

/** Better Auth integration, assembled only by authentication startup. */
export interface IdentityProvider {
  /** Reentrant scope holding locks through persistence and lifecycle hooks. */
  withIdentityRequest<T>(run: () => Promise<T>): Promise<T>;
  /** Acquire locks before Better Auth reads membership state. */
  beforeMembershipMutation?(): Promise<void>;
  identityAdapter(): ReturnType<typeof drizzleAdapter>;
  organizationHooks(): ApplicationOrganizationHooks;
  authPlugins?(
    createOrganization: (input: {
      body: { name: string; slug: string; userId: string };
    }) => Promise<unknown>,
  ): BetterAuthPlugin[];
  createSessionOnboardingHook: SessionOnboardingHookFactory;
}
