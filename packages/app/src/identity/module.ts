import "@tanstack/react-start/server-only";
import { apiKey } from "@better-auth/api-key";
import { oauthProvider } from "@better-auth/oauth-provider";
import { type BetterAuthOptions, betterAuth } from "better-auth";
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
  invitationIdFromRedirect,
  invitationUrl,
} from "#app/common/invitation.ts";
import type { ApplicationIdentity } from "#app/composition/identity.ts";
import type { Database } from "#app/db/database.ts";
import { member, session as sessionTable, user as userTable } from "#app/db/schema/index.ts";
import { enforceIdentityPolicy } from "#app/identity/enforce-policy.ts";
import { membershipMutationPlugin, membershipOrganizationHooks } from "#app/identity/membership.ts";
import { selectSoleOrganization } from "#app/lib/auto-org.ts";
import {
  cliDeviceOrganizationPlugin,
  getCapturedDeviceOrganizationId,
  runWithDeviceOrgCapture,
} from "#app/lib/cli-device-organization.ts";
import type {
  sendInvitationEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "#app/lib/email.server.tsx";
import { createIdentityAuthHooks, type ResolvedSession } from "#app/telemetry/auth-identity.ts";
import { exceptionAttributes, serverLogger } from "#app/telemetry/logger.ts";
import { createAccountLifecycle } from "./account";
import { invitationVisibilityPlugin } from "./invitations";

async function getMarkedDeviceOrganizationId(db: Database, session: { userId: string }) {
  // Captured by the /device/token before-hook (see cli-device-organization).
  const organizationId = getCapturedDeviceOrganizationId();
  if (!organizationId) {
    return null;
  }

  const membership = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, session.userId), eq(member.organizationId, organizationId)))
    .limit(1);

  return membership[0]?.organizationId ?? null;
}

// The org the user most recently had active, read off their latest session.
// A new login (notably CLI/device login) should land on the same org the user
// was last using instead of an arbitrary membership. `session.updatedAt` bumps
// whenever the active org changes, so the freshest session holds the current org.
async function getLastUsedOrganizationId(db: Database, session: { userId: string }) {
  const recentSession = await db
    .select({ organizationId: sessionTable.activeOrganizationId })
    .from(sessionTable)
    .where(
      and(eq(sessionTable.userId, session.userId), isNotNull(sessionTable.activeOrganizationId)),
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
    .where(and(eq(member.userId, session.userId), eq(member.organizationId, candidateOrgId)))
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

async function activeOrgRole(
  db: Database,
  session: { userId: string; activeOrganizationId?: unknown },
): Promise<string | null> {
  const organizationId = selectedOrgId(session.activeOrganizationId);
  if (!organizationId) return null;
  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, session.userId), eq(member.organizationId, organizationId)))
    .limit(1);
  return membership?.role ?? null;
}

export interface IdentityDependencies {
  database: Database;
  baseURL: string;
  secret: string;
  socialProviders?: BetterAuthOptions["socialProviders"];
  email: {
    enabled: boolean;
    sendInvitation: typeof sendInvitationEmail;
    sendPasswordReset: typeof sendPasswordResetEmail;
    sendVerification: typeof sendVerificationEmail;
  };
  canInviteMembers(this: void, organizationId: string): Promise<boolean>;
}

/** Shared identity behavior, constructed by the selected application's server entry. */
export function createApplicationAuth(
  { policy, provider }: ApplicationIdentity,
  { database: db, baseURL, secret, socialProviders, email, canInviteMembers }: IdentityDependencies,
) {
  const assertCanInviteMembers = async (organizationId: string) => {
    if (!(await canInviteMembers(organizationId)))
      throw new APIError("FORBIDDEN", {
        message: "Invitations are unavailable for this organization.",
      });
  };
  const { authPlugins, identityAdapter, organizationHooks, createSessionOnboardingHook } = provider;
  const creationHooks = organizationHooks();
  const mcpResource = `${baseURL.replace(/\/$/, "")}/mcp`;

  const auth = betterAuth({
    baseURL,
    secret,
    // Trust both loopback forms of the base URL: in dev the app may be reached on
    // 127.0.0.1 while BETTER_AUTH_URL is localhost (or vice-versa). In production
    // BETTER_AUTH_URL is a real host, so the replaces are no-ops. (The MCP org
    // picker/consent avoid this check entirely by running set-active/continue/
    // consent server-side via auth.api — see data/mcp/oauth.ts.)
    trustedOrigins: Array.from(
      new Set([
        baseURL,
        baseURL.replace("localhost", "127.0.0.1"),
        baseURL.replace("127.0.0.1", "localhost"),
      ]),
    ),
    database: identityAdapter(),
    ...(socialProviders ? { socialProviders: socialProviders } : {}),
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: async (user): Promise<void> => accounts.beforeDeleteUser(user.id),
      },
    },
    onAPIError: {
      errorURL: "/auth/error",
    },
    emailAndPassword: {
      enabled: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: email.enabled
        ? async ({ user, url }) => {
            email.sendPasswordReset({ to: user.email, url });
          }
        : undefined,
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        email.sendVerification({ to: user.email, url });
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
        create: {
          before: async (user, context) => {
            const callbackURL = context?.body?.callbackURL;
            await enforceIdentityPolicy(() =>
              policy.beforeUserCreate(
                user,
                invitationIdFromRedirect(typeof callbackURL === "string" ? callbackURL : undefined),
              ),
            );
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            let activeOrganizationId = await getMarkedDeviceOrganizationId(db, session);

            // Prefer the org the user most recently had active (their "current"
            // org) so a fresh login reuses it instead of picking the first one.
            if (!activeOrganizationId) {
              activeOrganizationId = await getLastUsedOrganizationId(db, session);
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
                existingMemberships.map((membership) => membership.organizationId),
              );
            }

            return {
              data: {
                ...session,
                activeOrganizationId,
              },
            };
          },
          after: createSessionOnboardingHook(async (body): Promise<{ id: string } | null> =>
            createOrganization({ body }),
          ),
        },
      },
    },
    hooks: createIdentityAuthHooks(
      async (headers): Promise<{ response: ResolvedSession | null; headers: Headers }> =>
        auth.api.getSession({ headers, returnHeaders: true }),
    ),
    plugins: [
      invitationVisibilityPlugin(),
      cliDeviceOrganizationPlugin({
        onError: (stage, error) => {
          serverLogger.error(`cli_device_organization.${stage}.failed`, exceptionAttributes(error));
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
        requireEmailVerificationOnInvitation: email.enabled,
        cancelPendingInvitationsOnReInvite: true,
        sendInvitationEmail: async (data, request) => {
          if (request?.headers.get(INVITATION_EMAIL_HEADER) === "false") return;
          email.sendInvitation({
            to: data.email,
            inviterName: data.inviter.user.name,
            organizationName: data.organization.name,
            role: data.role,
            inviteUrl: invitationUrl(data.id, baseURL),
          });
        },
        organizationHooks: {
          ...creationHooks,
          beforeCreateOrganization: async (input) => {
            await provider.lockUserLifecycle(input.user.id);
            // Better Auth resolved the user before this lock. Deletion may have
            // finished in between, so do not create from that stale user object.
            const [user] = await db
              .select({ id: userTable.id })
              .from(userTable)
              .where(eq(userTable.id, input.user.id));
            if (!user)
              throw new APIError("UNAUTHORIZED", {
                message: "Unauthenticated",
              });
            return creationHooks.beforeCreateOrganization?.(input);
          },
          ...membershipOrganizationHooks(policy),
          beforeAddMember: async ({ member: newMember }) => {
            const existingMembers = await db
              .select({ id: member.id })
              .from(member)
              .where(eq(member.organizationId, newMember.organizationId))
              .limit(1);
            if (existingMembers.length === 0) return;

            await assertCanInviteMembers(newMember.organizationId);
            await enforceIdentityPolicy(() =>
              policy.beforeMembershipChange(
                newMember.organizationId,
                newMember.userId,
                newMember.role,
              ),
            );
          },
          beforeCreateInvitation: async ({ invitation: newInvitation }) => {
            await assertCanInviteMembers(newInvitation.organizationId);
          },
          beforeAcceptInvitation: async ({ invitation: acceptedInvitation, user }) => {
            await assertCanInviteMembers(acceptedInvitation.organizationId);
            await enforceIdentityPolicy(() =>
              policy.beforeMembershipChange(
                acceptedInvitation.organizationId,
                user.id,
                acceptedInvitation.role,
              ),
            );
          },
          beforeDeleteOrganization: async ({ organization }) => {
            await enforceIdentityPolicy(() => policy.assertDeletable(organization.id));
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
      membershipMutationPlugin(
        policy,
        async (headers): Promise<{ user: { id: string } } | null> =>
          auth.api.getSession({ headers }),
        provider.beforeMembershipMutation,
      ),
      ...(authPlugins?.(
        async (input: { body: { name: string; slug: string; userId: string } }): Promise<unknown> =>
          createOrganization(input),
      ) ?? []),
      jwt({ disableSettingJwtHeader: true, disabledPaths: ["/token"] }),
      oauthProvider({
        loginPage: "/auth/sign-in",
        consentPage: "/mcp/consent",
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        // MCP native clients omit application_type when registering loopback callbacks.
        clientRegistrationDefaultApplicationType: "infer",
        clientPrivileges: async ({ action, session }) => {
          if (!session) return false;
          if (action === "create") return true;
          const role = await activeOrgRole(db, session);
          const roles = role?.split(",").map((value) => value.trim()) ?? [];
          return roles.includes("owner") || roles.includes("admin");
        },
        resources: [mcpResource],
        clientRegistrationDefaultResources: [mcpResource],
        scopes: ["openid", "profile", "email", "offline_access", "observability:read"],
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

  // Preserve Better Auth's response options and endpoint metadata while giving
  // server calls the same lock lifetime as HTTP requests and account deletion.
  const createOrganization: typeof auth.api.createOrganization = Object.assign(
    (input: Parameters<typeof auth.api.createOrganization>[0]) =>
      provider.withIdentityRequest(() => auth.api.createOrganization(input)),
    auth.api.createOrganization,
  );

  const accounts = createAccountLifecycle({
    database: db,
    api: auth.api,
    policy,
    withIdentityRequest: provider.withIdentityRequest,
    lockUserLifecycle: provider.lockUserLifecycle,
    lockAccountDeletion: provider.lockAccountDeletion,
    sessionFreshAge: async () => (await auth.$context).sessionConfig.freshAge,
  });
  return {
    ...auth,
    api: { ...auth.api, createOrganization },
    deleteAccount: accounts.deleteAccount,
    handler: (request: Request) =>
      provider.withIdentityRequest(() => runWithDeviceOrgCapture(() => auth.handler(request))),
  };
}
