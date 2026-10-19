import type { BetterAuthPlugin, GenericEndpointContext } from "better-auth";
import type { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { OrganizationOptions } from "better-auth/plugins/organization";
import type { SessionOnboardingHookFactory } from "./onboarding";

/** Authorization hooks owned by the shared authentication module. */
type SharedOrganizationHook =
  | "beforeAddMember"
  | "beforeCreateInvitation"
  | "beforeAcceptInvitation"
  | "beforeDeleteOrganization";

/** Organization lifecycle extensions outside the shared authorization policy. */
type ApplicationOrganizationHooks = Omit<
  NonNullable<OrganizationOptions["organizationHooks"]>,
  SharedOrganizationHook
> & { [Hook in SharedOrganizationHook]?: never };

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
  /** Account and membership policy shared by the authentication entry points. */
  identityLifecycle: {
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
  authPlugins(
    createOrganization: (input: {
      body: { name: string; slug: string; userId: string };
    }) => Promise<unknown>,
  ): BetterAuthPlugin[];
  /** Endpoint-level membership policy for mutations outside organization hooks. */
  membershipPlugin: BetterAuthPlugin;
  /** Signup admission policy for new identities, including invitation requirements. */
  beforeUserCreate(
    user: { email: string; emailVerified?: boolean },
    context: GenericEndpointContext | null,
  ): Promise<void>;
  /** Session-onboarding integration for the application's organization creation and selection model. */
  createSessionOnboardingHook: SessionOnboardingHookFactory;
}
