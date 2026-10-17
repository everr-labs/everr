import type { ClickHouseSettings } from "@clickhouse/client";
import type { BetterAuthPlugin, GenericEndpointContext } from "better-auth";
import type { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { OrganizationOptions } from "better-auth/plugins/organization";
import type { MigrationDatabase } from "@/db/migrations";
import type { SessionOnboardingHookFactory } from "./onboarding";

export interface ApplicationIdentity {
  identityAdapter(): ReturnType<typeof drizzleAdapter>;
  organizationHooks(): NonNullable<OrganizationOptions["organizationHooks"]>;
  identityLifecycle: {
    beforeUserDelete(userId: string): Promise<void>;
    beforeMembershipChange(
      orgId: string,
      userId: string,
      role: string | null,
    ): Promise<void>;
    assertDeletable(orgId: string): Promise<void>;
  };
  authPlugins(
    createOrganization: (input: {
      body: { name: string; slug: string; userId: string };
    }) => Promise<unknown>,
  ): BetterAuthPlugin[];
  membershipPlugin: BetterAuthPlugin;
  beforeUserCreate(
    user: { email: string; emailVerified?: boolean },
    context: GenericEndpointContext | null,
  ): Promise<void>;
  createSessionOnboardingHook: SessionOnboardingHookFactory;
}

export interface ApplicationServer {
  loadIdentity(): Promise<ApplicationIdentity>;
  withIdentityRequest<T>(run: () => Promise<T>): Promise<T>;
  assertAccountDeletionAllowed(
    organizations: Array<{ id: string; name: string } | null>,
  ): void | Promise<void>;
  appQuerySettings(
    organizationId: string,
    settings?: ClickHouseSettings,
  ): ClickHouseSettings | undefined;
  sqlApiAccess(organizationId: string): {
    auth: { username: string; password: string };
    http_headers?: Record<string, string>;
  };
  assertStorageReady(metadata: unknown): void;
  decorateTelemetryRow<T extends object>(organizationId: string, row: T): T;
  ingestIdentity(organizationId: string): { tenantId?: string };
  internalIngestHeaders(organizationId: string): Record<string, string>;
  getIngestEndpoint(): string | undefined;
  getAppEntry(): Promise<{ setupRequired: boolean }>;
  canOpenSignup(input: { redirect?: string }): Promise<boolean>;
  migrateDatabase(database: MigrationDatabase): Promise<void>;
  startAppWorkers(): Promise<void>;
  stopAppWorkers(): Promise<void>;
}
