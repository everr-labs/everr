import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import type { ApplicationIdentity } from "#app/composition/identity.ts";
import { db } from "#app/db/client.ts";
import { identityPolicy } from "../identity-policy.server";
import { lockWorkspaceMembership, withIdentityRequest } from "../request";

export const identity = {
  policy: identityPolicy,
  provider: {
    withIdentityRequest,
    beforeMembershipMutation: lockWorkspaceMembership,
    createSessionOnboardingHook: () => async () => {},
    identityAdapter: () => drizzleAdapter(db, { provider: "pg" }),
    organizationHooks: () => ({
      async beforeCreateOrganization() {
        throw new APIError("FORBIDDEN", {
          message:
            "This installation supports one workspace. Use initial setup to create it.",
        });
      },
    }),
  },
} satisfies ApplicationIdentity;
