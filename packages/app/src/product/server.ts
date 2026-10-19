import type { ClickHouseSettings } from "@clickhouse/client";
import type { BetterAuthPlugin, GenericEndpointContext } from "better-auth";
import type { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { OrganizationOptions } from "better-auth/plugins/organization";
import type { MigrationDatabase } from "#app/db/migrations.ts";
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

/**
 * The server-side deployment adapter for the shared application. Identity,
 * tenancy, installation entry, and operational lifecycle belong to the selected
 * application; shared features depend on this contract rather than its implementation.
 */
export interface ApplicationServer {
  /** Lazy identity composition, separate from settings needed before authentication initializes. */
  loadIdentity(): Promise<ApplicationIdentity>;
  /** Account-deletion eligibility across owned organizations, complementary to mutation-time guards. */
  assertAccountDeletionAllowed(
    organizations: Array<{ id: string; name: string } | null>,
  ): void | Promise<void>;
  /** Query isolation settings for the deployment's tenancy model. */
  appQuerySettings(
    organizationId: string,
    settings?: ClickHouseSettings,
  ): ClickHouseSettings | undefined;
  /** Organization-scoped SQL access, separate from the application's database identity. */
  sqlApiAccess(organizationId: string): {
    /** SQL API credentials for the selected organization. */
    auth: { username: string; password: string };
    /** Additional transport identity required by the deployment's SQL gateway. */
    http_headers?: Record<string, string>;
  };
  /** Organization storage-readiness policy, based on application-owned provisioning metadata. */
  assertStorageReady(metadata: unknown): void;
  /** The deployment's organization identity representation in stored telemetry rows. */
  decorateTelemetryRow<T extends object>(organizationId: string, row: T): T;
  /** Collector-facing tenant identity associated with an ingestion key. */
  ingestIdentity(organizationId: string): { tenantId?: string };
  /** Organization identity carried by internal telemetry forwarding requests. */
  internalIngestHeaders(organizationId: string): Record<string, string>;
  /** Public collector address advertised to clients; undefined represents an unconfigured endpoint. */
  getIngestEndpoint(): string | undefined;
  /** Installation bootstrap state for the application's entry flow. */
  getAppEntry(): Promise<{ setupRequired: boolean }>;
  /** Signup-page eligibility for a destination, distinct from admission of a specific identity. */
  canOpenSignup(input: { redirect?: string }): Promise<boolean>;
  /** Database upgrade lifecycle for the application's shared and additional schema histories. */
  migrateDatabase(database: MigrationDatabase): Promise<void>;
  /** Startup lifecycle for application-owned background workers, alongside shared workers. */
  startAppWorkers(): Promise<void>;
  /** Shutdown lifecycle for application-owned workers and their resources. */
  stopAppWorkers(): Promise<void>;
}
