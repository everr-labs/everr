import { apiKey } from "@better-auth/api-key";
import { oauthProvider } from "@better-auth/oauth-provider";
import { server } from "@composition/server";
import { betterAuth } from "better-auth";
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
import {
  INVITATION_EMAIL_HEADER,
  invitationUrl,
} from "#app/common/invitation.ts";
import { db } from "#app/db/client.ts";
import { member, session as sessionTable } from "#app/db/schema/index.ts";
import { env } from "#app/env/index.ts";
import { socialProviders } from "#app/lib/auth-providers.server.ts";
import { selectSoleOrganization } from "#app/lib/auto-org.ts";
import {
  cliDeviceOrganizationPlugin,
  getCapturedDeviceOrganizationId,
} from "#app/lib/cli-device-organization.ts";
import {
  sendInvitationEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "#app/lib/email.server.tsx";
import { mailer } from "#app/lib/mailer.server.ts";
import { MCP_RESOURCE } from "#app/lib/mcp-resource.ts";
import { assertCanInviteMembers } from "#app/product/membership.server.ts";
import {
  createIdentityAuthHooks,
  type ResolvedSession,
} from "#app/telemetry/auth-identity.ts";
import { exceptionAttributes, serverLogger } from "#app/telemetry/logger.ts";

const {
  authPlugins,
  identityAdapter,
  identityLifecycle,
  membershipPlugin,
  organizationHooks,
  beforeUserCreate,
  createSessionOnboardingHook,
} = await server.loadIdentity();

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
  database: identityAdapter(),
  ...(socialProviders ? { socialProviders: socialProviders } : {}),
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
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: mailer
      ? async ({ user, url }) => {
          sendPasswordResetEmail({ to: user.email, url });
        }
      : undefined,
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
    user: {
      create: { before: beforeUserCreate },
      delete: {
        before: async (user) => {
          await identityLifecycle.beforeUserDelete(user.id);
        },
      },
    },
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

          // A single membership is unambiguous. If there are several and no
          // previous selection, leave the session without an active org so the
          // user can choose rather than depending on database row order.
          if (!activeOrganizationId) {
            const existingMemberships = await db
              .select({
                organizationId: member.organizationId,
              })
              .from(member)
              .where(eq(member.userId, session.userId))
              .limit(2);

            activeOrganizationId = selectSoleOrganization(
              existingMemberships.map(
                (membership) => membership.organizationId,
              ),
            );
          }

          return {
            data: {
              ...session,
              activeOrganizationId,
            },
          };
        },
        after: createSessionOnboardingHook(
          async (body): Promise<{ id: string } | null> =>
            auth.api.createOrganization({ body }),
        ),
      },
    },
  },
  hooks: createIdentityAuthHooks(
    async (
      headers,
    ): Promise<{ response: ResolvedSession | null; headers: Headers }> =>
      auth.api.getSession({ headers, returnHeaders: true }),
  ),
  plugins: [
    membershipPlugin,
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
      // Organization creation is controlled by server-owned flows.
      allowUserToCreateOrganization: false,
      creatorRole: "owner",
      // Without SMTP, the invitation link authorizes signup for its recipient.
      // With SMTP, Better Auth also requires proof of email ownership.
      requireEmailVerificationOnInvitation: mailer !== null,
      cancelPendingInvitationsOnReInvite: true,
      sendInvitationEmail: async (data, request) => {
        if (request?.headers.get(INVITATION_EMAIL_HEADER) === "false") return;
        sendInvitationEmail({
          to: data.email,
          inviterName: data.inviter.user.name,
          organizationName: data.organization.name,
          role: data.role,
          inviteUrl: invitationUrl(data.id, env.BETTER_AUTH_URL),
        });
      },
      organizationHooks: {
        ...organizationHooks(),
        beforeAddMember: async ({ member: newMember }) => {
          const existingMembers = await db
            .select({ id: member.id })
            .from(member)
            .where(eq(member.organizationId, newMember.organizationId))
            .limit(1);
          if (existingMembers.length === 0) return;

          await assertCanInviteMembers(newMember.organizationId);
          await identityLifecycle.beforeMembershipChange(
            newMember.organizationId,
            newMember.userId,
            newMember.role,
          );
        },
        beforeCreateInvitation: async ({ invitation: newInvitation }) => {
          await assertCanInviteMembers(newInvitation.organizationId);
        },
        beforeAcceptInvitation: async ({
          invitation: acceptedInvitation,
          user,
        }) => {
          await assertCanInviteMembers(acceptedInvitation.organizationId);
          await identityLifecycle.beforeMembershipChange(
            acceptedInvitation.organizationId,
            user.id,
            acceptedInvitation.role,
          );
        },
        beforeDeleteOrganization: async ({ organization }) => {
          await identityLifecycle.assertDeletable(organization.id);
        },
      },
    }),
    deviceAuthorization(),
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
        // Public browser keys store `{ public: true, allowedOrigins }` in
        // the metadata JSON column; the plugin rejects metadata on create
        // unless this is on.
        enableMetadata: true,
        // No default permissions on purpose: capability choice is explicit.
        // A key created without a `permissions` map grants nothing — the
        // collector verify and apply endpoints check the scope and reject a
        // key with no capabilities. The API keys UI always sends an explicit,
        // least-privilege scope set (at least one capability). Keys minted
        // before scopes existed are backfilled with the full set by
        // the API-key capabilities backfill migration.
      },
    ]),
    bearer(),
    ...authPlugins(
      async (input: {
        body: { name: string; slug: string; userId: string };
      }): Promise<unknown> => auth.api.createOrganization(input),
    ),
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
