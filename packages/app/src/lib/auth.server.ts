import { apiKey } from "@better-auth/api-key";
import { polar, webhooks } from "@polar-sh/better-auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import {
  bearer,
  deviceAuthorization,
  organization as organizationPlugin,
} from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { deviceCode, invitation, member, user } from "@/db/schema";
import { env } from "@/env";
import { deriveOrgName, generateOrgSlug } from "@/lib/auto-org";
import { upsertOrgSubscription } from "@/lib/billing-data.server";
import {
  deprovisionSqlApiOrgUser,
  provisionSqlApiOrgUser,
  upsertTenantRetention,
} from "@/lib/clickhouse";
import {
  getActiveOrganizationIdFromAuthSession,
  getDeviceOrgIdFromScope,
  withDeviceOrgScope,
} from "@/lib/device-org-scope";
import {
  sendInvitationEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "@/lib/email.server";
import { ensurePolarCustomerForOrg, polarClient } from "@/lib/polar.server";
import { resolveRetention } from "@/lib/retention";

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

type AuthContextLike = {
  path?: string;
  body?: unknown;
};

function getStringBodyField(context: unknown, field: string) {
  const body = (context as AuthContextLike | null)?.body;
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const value = (body as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

async function getMarkedDeviceOrganizationId(
  session: { userId: string },
  context: unknown,
) {
  const path = (context as AuthContextLike | null)?.path;
  if (path !== "/device/token") {
    return null;
  }

  const deviceCodeValue = getStringBodyField(context, "device_code");
  if (!deviceCodeValue) {
    return null;
  }

  const deviceCodeRecord = await db
    .select({ scope: deviceCode.scope })
    .from(deviceCode)
    .where(eq(deviceCode.deviceCode, deviceCodeValue))
    .limit(1);

  const organizationId = getDeviceOrgIdFromScope(deviceCodeRecord[0]?.scope);
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

async function syncSubscription({ data }: { data: PolarSubscriptionPayload }) {
  const orgId = data.customer.externalId;
  if (!orgId) {
    console.warn("[polar webhook] subscription has no externalId", {
      subscriptionId: data.id,
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

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
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
  databaseHooks: {
    user: {
      create: {
        // TODO: this is a very basic form of avoiding signups from non-invited users.
        // It doesn't force users to signup via the email invitation link, so users can basically signup by themselves without joining the organization that invited them,
        // but it's good enough for now given we'll remove this limitation soon anyway.
        before: async (userData) => {
          if (!env.REQUIRE_INVITATION_FOR_SIGNUP) {
            return true;
          }

          const pending = await db
            .select({ id: invitation.id })
            .from(invitation)
            .where(
              and(
                eq(invitation.email, userData.email),
                eq(invitation.status, "pending"),
              ),
            )
            .limit(1);

          if (pending.length === 0) {
            throw new APIError("FORBIDDEN", {
              message: "Signup is by invitation only",
            });
          }
        },
      },
    },
    session: {
      create: {
        before: async (session, context) => {
          let activeOrganizationId = await getMarkedDeviceOrganizationId(
            session,
            context,
          );

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
                console.error(
                  "[auto-org] failed to create personal organization",
                  { userId: session.userId, error },
                );
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
    {
      id: "cli-device-organization",
      hooks: {
        before: [
          {
            matcher: (context) => context.path === "/device/approve",
            handler: createAuthMiddleware(async (context) => {
              const browserSession = await getSessionFromCtx(context);
              const activeOrganizationId =
                getActiveOrganizationIdFromAuthSession(browserSession);
              const userCode = getStringBodyField(context, "userCode")?.replace(
                /-/g,
                "",
              );

              if (!activeOrganizationId || !userCode) {
                return { context };
              }

              const deviceCodeRecord = await db
                .select({ id: deviceCode.id, scope: deviceCode.scope })
                .from(deviceCode)
                .where(eq(deviceCode.userCode, userCode))
                .limit(1);

              const record = deviceCodeRecord[0];
              if (!record) {
                return { context };
              }

              await db
                .update(deviceCode)
                .set({
                  scope: withDeviceOrgScope(record.scope, activeOrganizationId),
                })
                .where(eq(deviceCode.id, record.id));

              return { context };
            }),
          },
        ],
      },
    },
    organizationPlugin({
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
            console.error("[polar] failed to create customer for org", {
              orgId: organization.id,
              error,
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
            console.error("[retention] failed to seed retention for org", {
              orgId: organization.id,
              error,
            });
          }

          // Provision the per-org ClickHouse user + row policies that back
          // the /api/cli/sql endpoint's tenant isolation. Each /sql query
          // authenticates as exactly this org's user; without provisioning,
          // the org's users couldn't authenticate at all. Idempotent.
          try {
            await provisionSqlApiOrgUser(organization.id);
          } catch (error) {
            console.error("[sql-api] failed to provision org user", {
              orgId: organization.id,
              error,
            });
          }
        },
        afterDeleteOrganization: async ({ organization }) => {
          try {
            await deprovisionSqlApiOrgUser(organization.id);
          } catch (error) {
            console.error("[sql-api] failed to deprovision org user", {
              orgId: organization.id,
              error,
            });
          }
        },
      },
    }),
    // Empty `schema` works around a better-auth@1.6.9 bug: its options Zod
    // schema declares `schema` non-optional, so calling deviceAuthorization()
    // without args fails parse with "expected nonoptional, received undefined".
    deviceAuthorization({ schema: {} }),
    apiKey({
      references: "user",
    }),
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
    tanstackStartCookies(), // must be last
  ],
  logger: {
    level: "debug",
  },
});
