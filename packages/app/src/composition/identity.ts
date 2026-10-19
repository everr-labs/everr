import type { BetterAuthPlugin, GenericEndpointContext } from "better-auth";
import type { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { OrganizationOptions } from "better-auth/plugins/organization";
import type { SessionOnboardingHookFactory } from "./onboarding";

/** Organization creation extensions. Membership and deletion hooks are shared-owned. */
type OrganizationHooks = NonNullable<OrganizationOptions["organizationHooks"]>;
type CreationHook = "beforeCreateOrganization" | "afterCreateOrganization";
type ApplicationOrganizationHooks = Pick<OrganizationHooks, CreationHook> & {
  [Hook in Exclude<keyof OrganizationHooks, CreationHook>]?: never;
};

/**
 * The application's identity model: credential persistence, membership policy,
 * and account lifecycle. This is the application-specific part of the shared
 * authentication module, including the lock scope its policies depend on.
 */
export interface ApplicationIdentity {
  /**
   * A reentrant identity-mutation scope. Its locks belong to the whole operation,
   * including persistence and lifecycle hooks, rather than an individual check.
   */
  withIdentityRequest<T>(run: () => Promise<T>): Promise<T>;
  /** Persistence adapter, including transactional organization lifecycle work. */
  identityAdapter(): ReturnType<typeof drizzleAdapter>;
  /** Application lifecycle extensions around organization persistence and membership changes. */
  organizationHooks(): ApplicationOrganizationHooks;
  /** Account-deletion preflight, complementary to mutation-time guards. */
  assertAccountDeletionAllowed(
    organizations: Array<{ id: string; name: string }>,
  ): void | Promise<void>;
  /** Account and membership policy shared by the authentication entry points. */
  identityLifecycle: {
    /** Acquire application locks before the authentication provider reads membership state. */
    beforeMembershipMutation?(): Promise<void>;
    /** Reconcile application state after a membership change commits. */
    afterMembershipChange(orgId: string): Promise<void>;
    /** Account-removal policy, including obligations to organizations the user owns. */
    beforeUserDelete(userId: string): Promise<void>;
    /** Membership-transition policy; a null role represents departure from the organization. */
    beforeMembershipChange(
      orgId: string,
      userId: string,
      role: string | null,
    ): Promise<void>;
    /** Organization-removal policy, including application-specific ownership and lifecycle constraints. */
    assertDeletable(orgId: string): Promise<void>;
  };
  /** Additional authentication integrations, with access to the shared organization-creation flow. */
  authPlugins?(
    createOrganization: (input: {
      body: { name: string; slug: string; userId: string };
    }) => Promise<unknown>,
  ): BetterAuthPlugin[];
  /** Signup admission policy for new identities, including invitation requirements. */
  beforeUserCreate(
    user: { email: string; emailVerified?: boolean },
    context: GenericEndpointContext | null,
  ): Promise<void>;
  /** Session-onboarding integration for the application's organization creation and selection model. */
  createSessionOnboardingHook: SessionOnboardingHookFactory;
}
