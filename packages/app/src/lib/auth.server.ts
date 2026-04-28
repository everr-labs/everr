import { apiKey } from "@better-auth/api-key";
import { polar, webhooks } from "@polar-sh/better-auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import {
  bearer,
  deviceAuthorization,
  organization as organizationPlugin,
} from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { invitation, member, user } from "@/db/schema";
import { env } from "@/env";
import { deriveOrgName, generateOrgSlug } from "@/lib/auto-org";
import { upsertOrgSubscription } from "@/lib/billing-data.server";
import {
  sendInvitationEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "@/lib/email.server";
import { ensurePolarCustomerForOrg, polarClient } from "@/lib/polar.server";

type PolarSubscriptionPayload = {
  id: string;
  status: string;
  productId: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  customer: { externalId?: string | null };
};

async function syncSubscription(data: PolarSubscriptionPayload) {
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
        before: async (session) => {
          // Look for an existing membership to set as active org.
          const existingMembership = await db
            .select({
              organizationId: member.organizationId,
            })
            .from(member)
            .where(eq(member.userId, session.userId))
            .limit(1);

          let activeOrganizationId =
            existingMembership[0]?.organizationId ?? null;

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
        },
      },
    }),
    deviceAuthorization(),
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
          onSubscriptionCreated: async ({ data }) => {
            await syncSubscription(data);
          },
          onSubscriptionUpdated: async ({ data }) => {
            await syncSubscription(data);
          },
          onSubscriptionActive: async ({ data }) => {
            await syncSubscription(data);
          },
          onSubscriptionUncanceled: async ({ data }) => {
            await syncSubscription(data);
          },
          onSubscriptionCanceled: async ({ data }) => {
            await syncSubscription(data);
          },
          onSubscriptionRevoked: async ({ data }) => {
            await syncSubscription(data);
          },
        }),
      ],
    }),
    tanstackStartCookies(), // must be last
  ],
  logger: {
    level: "debug",
  },
});
