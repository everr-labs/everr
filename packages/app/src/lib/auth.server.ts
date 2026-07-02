import { apiKey } from "@better-auth/api-key";
import { oauthProvider } from "@better-auth/oauth-provider";
import { polar, webhooks } from "@polar-sh/better-auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import {
  bearer,
  deviceAuthorization,
  jwt,
  organization as organizationPlugin,
} from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { member, session as sessionTable, user } from "@/db/schema";
import { env } from "@/env";
import { deriveOrgName, generateOrgSlug } from "@/lib/auto-org";
import { upsertOrgSubscription } from "@/lib/billing-data.server";
import {
  cliDeviceOrganizationPlugin,
  getCapturedDeviceOrganizationId,
} from "@/lib/cli-device-organization";
import {
  deprovisionSqlApiOrgUser,
  provisionSqlApiOrgUser,
  upsertTenantRetention,
} from "@/lib/clickhouse";
import {
  sendInvitationEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "@/lib/email.server";
import { MCP_RESOURCE } from "@/lib/mcp-resource";
import { deletePostgresOrganizationData } from "@/lib/organization-data-cleanup.server";
import { ensurePolarCustomerForOrg, polarClient } from "@/lib/polar.server";
import { resolveRetention } from "@/lib/retention";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";

type PolarSubscriptionPayload = {
  id: string;
  status: string;
  productId: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  modifiedAt: Date | null;
  createdAt: Date;
  customer: { externalId?: string | null };
};

async function getMarkedDeviceOrganizationId(session: { userId: string }) {
  // Captured by the /device/token before-hook (see cli-device-organization).
  const organizationId = getCapturedDeviceOrganizationId();
  if (!organizationId) {
    return null;
  }

  const membership = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(
      and(
        eq(member.userId, session.userId),
        eq(member.organizationId, organizationId),
      ),
    )
    .limit(1);

  return membership[0]?.organizationId ?? null;
}

// The org the user most recently had active, read off their latest session.
// A new login (notably CLI/device login) should land on the same org the user
// was last using instead of an arbitrary membership. `session.updatedAt` bumps
// whenever the active org changes, so the freshest session holds the current org.
async function getLastUsedOrganizationId(session: { userId: string }) {
  const recentSession = await db
    .select({ organizationId: sessionTable.activeOrganizationId })
    .from(sessionTable)
    .where(
      and(
        eq(sessionTable.userId, session.userId),
        isNotNull(sessionTable.activeOrganizationId),
      ),
    )
    .orderBy(desc(sessionTable.updatedAt))
    .limit(1);

  const candidateOrgId = recentSession[0]?.organizationId ?? null;
  if (!candidateOrgId) {
    return null;
  }

  // Reuse it only if the user is still a member of that org.
  const membership = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(
      and(
        eq(member.userId, session.userId),
        eq(member.organizationId, candidateOrgId),
      ),
    )
    .limit(1);

  return membership[0]?.organizationId ?? null;
}

async function syncSubscription({ data }: { data: PolarSubscriptionPayload }) {
  const orgId = data.customer.externalId;
  if (!orgId) {
    serverLogger.warn("polar.webhook.subscription_missing_external_id", {
      "polar.subscription.id": data.id,
    });
    return;
  }
  await upsertOrgSubscription({
    orgId,
    polarSubscriptionId: data.id,
    polarProductId: data.productId,
    status: data.status,
    currentPeriodEnd: data.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: data.cancelAtPeriodEnd,
    polarModifiedAt: data.modifiedAt ?? data.createdAt,
  });
}

// Extend the org plugin's default access-control statement with apiKey
// permissions so admins (not just owners) can manage org-scoped ingest keys.
// Without these, the apiKey plugin's permission check (`apiKey: [<action>]`)
// resolves to false for admins because better-auth's default org roles have
// no apiKey statement.
const orgStatement = {
  ...defaultStatements,
  apiKey: ["create", "read", "update", "delete"],
} as const;

const orgAc = createAccessControl(orgStatement);

const orgRoles = {
  owner: orgAc.newRole({
    ...ownerAc.statements,
    apiKey: ["create", "read", "update", "delete"],
  }),
  admin: orgAc.newRole({
    ...adminAc.statements,
    apiKey: ["create", "read", "update", "delete"],
  }),
  member: orgAc.newRole({
    ...memberAc.statements,
  }),
};

const googleSocialProviders =
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
        },
      }
    : undefined;

// The selected organization id, or undefined if none is active yet. Shared by
// the MCP postLogin hooks so "is an org selected?" is decided one way (treating
// an empty string as unselected).
const selectedOrgId = (activeOrganizationId: unknown): string | undefined =>
  typeof activeOrganizationId === "string" && activeOrganizationId.length > 0
    ? activeOrganizationId
    : undefined;

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  // Trust both loopback forms of the base URL: in dev the app may be reached on
  // 127.0.0.1 while BETTER_AUTH_URL is localhost (or vice-versa). In production
  // BETTER_AUTH_URL is a real host, so the replaces are no-ops. (The MCP org
  // picker/consent avoid this check entirely by running set-active/continue/
  // consent server-side via auth.api — see data/mcp/oauth.ts.)
  trustedOrigins: Array.from(
    new Set([
      env.BETTER_AUTH_URL,
      env.BETTER_AUTH_URL.replace("localhost", "127.0.0.1"),
      env.BETTER_AUTH_URL.replace("127.0.0.1", "localhost"),
    ]),
  ),
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  ...(googleSocialProviders ? { socialProviders: googleSocialProviders } : {}),
  user: {
    deleteUser: {
      enabled: true,
    },
  },
  onAPIError: {
    errorURL: "/auth/error",
  },
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      sendPasswordResetEmail({ to: user.email, url });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      sendVerificationEmail({ to: user.email, url });
    },
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
  },
  account: {
    // Preserve pre-1.6.11 behavior: allow implicit OAuth account linking even
    // when the local account's email is unverified. 1.6.11 flipped the default
    // (`requireLocalEmailVerified`) to true.
    accountLinking: {
      requireLocalEmailVerified: false,
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          let activeOrganizationId =
            await getMarkedDeviceOrganizationId(session);

          // Prefer the org the user most recently had active (their "current"
          // org) so a fresh login reuses it instead of picking the first one.
          if (!activeOrganizationId) {
            activeOrganizationId = await getLastUsedOrganizationId(session);
          }

          // Look for an existing membership to set as active org.
          if (!activeOrganizationId) {
            const existingMembership = await db
              .select({
                organizationId: member.organizationId,
              })
              .from(member)
              .where(eq(member.userId, session.userId))
              .limit(1);

            activeOrganizationId =
              existingMembership[0]?.organizationId ?? null;
          }

          // If the user has no org (fresh signup, not via invite),
          // create a personal org so the session starts with one.
          if (!activeOrganizationId) {
            const userRecord = await db
              .select({ name: user.name, email: user.email })
              .from(user)
              .where(eq(user.id, session.userId))
              .limit(1);

            if (userRecord[0]) {
              const orgName = deriveOrgName(
                userRecord[0].name,
                userRecord[0].email,
              );

              try {
                await auth.api.createOrganization({
                  body: {
                    name: orgName,
                    slug: generateOrgSlug(),
                    metadata: { onboardingCompleted: false },
                    userId: session.userId,
                  },
                });

                // Re-query for the membership that was just created.
                const newMembership = await db
                  .select({ organizationId: member.organizationId })
                  .from(member)
                  .where(eq(member.userId, session.userId))
                  .limit(1);

                activeOrganizationId = newMembership[0]?.organizationId ?? null;
              } catch (error) {
                serverLogger.error("auto_org.create_personal_org.failed", {
                  ...exceptionAttributes(error),
                  "user.id": session.userId,
                });
              }
            }
          }

          return {
            data: {
              ...session,
              activeOrganizationId,
            },
          };
        },
      },
    },
  },
  plugins: [
    cliDeviceOrganizationPlugin({
      onError: (stage, error) => {
        serverLogger.error(
          `cli_device_organization.${stage}.failed`,
          exceptionAttributes(error),
        );
      },
    }),
    organizationPlugin({
      ac: orgAc,
      roles: orgRoles,
      // Preserve pre-1.6.11 behavior: don't require the recipient's email to be
      // verified to view/accept an invitation. 1.6.11 flipped this default to true.
      requireEmailVerificationOnInvitation: false,
      sendInvitationEmail: async (data) => {
        sendInvitationEmail({
          to: data.email,
          inviterName: data.inviter.user.name,
          organizationName: data.organization.name,
          role: data.role,
          inviteUrl: `${env.BETTER_AUTH_URL}/invite/${data.id}`,
        });
      },
      organizationHooks: {
        afterCreateOrganization: async ({ organization, user: creator }) => {
          try {
            await ensurePolarCustomerForOrg({
              orgId: organization.id,
              orgName: organization.name,
              fallbackEmail: creator.email,
            });
          } catch (error) {
            serverLogger.error("polar.customer.create_for_org.failed", {
              ...exceptionAttributes(error),
              "organization.id": organization.id,
            });
          }

          // Seed free-tier retention so the dictionary has an entry for this
          // tenant and TTL merges don't fall back to the dictGetOrDefault
          // baseline before the first subscription webhook arrives.
          try {
            const retention = resolveRetention("free");
            await upsertTenantRetention({
              tenantId: organization.id,
              tracesDays: retention.tracesDays,
              logsDays: retention.logsDays,
              metricsDays: retention.metricsDays,
            });
          } catch (error) {
            serverLogger.error("retention.seed_for_org.failed", {
              ...exceptionAttributes(error),
              "organization.id": organization.id,
            });
          }

          // Provision the per-org ClickHouse user + row policies that back
          // the /api/cli/sql endpoint's tenant isolation. Each /sql query
          // authenticates as exactly this org's user; without provisioning,
          // the org's users couldn't authenticate at all. Idempotent.
          try {
            await provisionSqlApiOrgUser(organization.id);
          } catch (error) {
            serverLogger.error("sql_api.org_user.provision.failed", {
              ...exceptionAttributes(error),
              "organization.id": organization.id,
            });
          }
        },
        afterDeleteOrganization: async ({ organization }) => {
          try {
            await deletePostgresOrganizationData(organization.id);
          } catch (error) {
            serverLogger.error("organization.postgres_data_cleanup.failed", {
              ...exceptionAttributes(error),
              "organization.id": organization.id,
            });
            throw error;
          }

          try {
            await deprovisionSqlApiOrgUser(organization.id);
          } catch (error) {
            serverLogger.error("sql_api.org_user.deprovision.failed", {
              ...exceptionAttributes(error),
              "organization.id": organization.id,
            });
          }
        },
      },
    }),
    // Empty `schema` works around a better-auth@1.6.9 bug: its options Zod
    // schema declares `schema` non-optional, so calling deviceAuthorization()
    // without args fails parse with "expected nonoptional, received undefined".
    deviceAuthorization({ schema: {} }),
    apiKey([
      {
        configId: "ingest",
        references: "organization",
        defaultPrefix: "ek_",
        requireName: true,
        // The collector hits the verify endpoint on every cache miss; better-
        // auth's default rate limit (10 / 24h) would quickly disable real
        // keys. Rate limiting against abuse lives in the collector cache and
        // the shared-secret-guarded verify endpoint, not here.
        rateLimit: { enabled: false },
        // No default permissions on purpose: capability choice is explicit.
        // A key created without a `permissions` map grants nothing — the
        // collector verify and apply endpoints check the scope and reject a
        // key with no capabilities. The API keys UI always sends an explicit,
        // least-privilege scope set (at least one capability). Keys minted
        // before scopes existed are backfilled with the full set by
        // drizzle/0006_backfill_api_key_capabilities.sql.
      },
    ]),
    bearer(),
    polar({
      client: polarClient,
      createCustomerOnSignUp: false,
      use: [
        webhooks({
          secret: env.POLAR_WEBHOOK_SECRET,
          onSubscriptionCreated: syncSubscription,
          onSubscriptionUpdated: syncSubscription,
          onSubscriptionActive: syncSubscription,
          onSubscriptionUncanceled: syncSubscription,
          onSubscriptionCanceled: syncSubscription,
          onSubscriptionRevoked: syncSubscription,
        }),
      ],
    }),
    jwt({ disableSettingJwtHeader: true, disabledPaths: ["/token"] }),
    oauthProvider({
      loginPage: "/auth/sign-in",
      consentPage: "/mcp/consent",
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      validAudiences: [MCP_RESOURCE],
      // The RFC 8414 authorization-server metadata is served at
      // "/.well-known/oauth-authorization-server/api/auth" (see the route of the
      // same path); silence better-auth's startup check now that it exists.
      silenceWarnings: { oauthAuthServerConfig: true },
      scopes: [
        "openid",
        "profile",
        "email",
        "offline_access",
        "observability:read",
      ],
      postLogin: {
        // `page` + `shouldRedirect` are required by the type, but we never
        // divert to a separate picker: the active org is shown and switchable on
        // the consent screen (see routes/mcp/consent.tsx), and it's bound here.
        // `page` is therefore unused; kept as a real route to avoid a dangling ref.
        page: "/mcp/consent",
        shouldRedirect: async () => false,
        consentReferenceId: async ({ session, scopes }) => {
          const orgId = selectedOrgId(session.activeOrganizationId);
          if (scopes.includes("observability:read") && !orgId) {
            throw new APIError("BAD_REQUEST", {
              message:
                "No active organization to authorize. Create one in Everr, then reconnect.",
            });
          }
          return orgId;
        },
      },
      customAccessTokenClaims: async ({ referenceId }) => ({
        org_id: referenceId,
      }),
    }),
    tanstackStartCookies(), // must be last
  ],
  logger: {
    level: "debug",
  },
});
