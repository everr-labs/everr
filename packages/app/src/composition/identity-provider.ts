import type { BetterAuthPlugin } from "better-auth";
import type { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { OrganizationOptions } from "better-auth/plugins/organization";
import type { DbExecutor } from "#app/db/database.ts";
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
  withIdentityRequest<T>(this: void, run: () => Promise<T>): Promise<T>;
  /** Acquire locks before Better Auth reads membership state. */
  beforeMembershipMutation?(this: void): Promise<void>;
  /** Exclude concurrent creation and deletion for this user until the request finishes. */
  lockUserLifecycle(this: void, userId: string): Promise<void>;
  /** Hold locks for the discovered organizations until the identity request finishes. */
  lockAccountDeletion(this: void, organizationIds: readonly string[]): Promise<void>;
  identityAdapter(this: void, executor: DbExecutor): ReturnType<typeof drizzleAdapter>;
  organizationHooks(this: void): ApplicationOrganizationHooks;
  authPlugins?(
    this: void,
    createOrganization: (input: {
      body: { name: string; slug: string; userId: string };
    }) => Promise<unknown>,
  ): BetterAuthPlugin[];
  createSessionOnboardingHook: SessionOnboardingHookFactory;
}
