import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import type { ApplicationIdentity } from "#app/composition/identity.ts";
import type { Database } from "#app/db/database.ts";
import { createInstallationIdentityPolicy } from "./identity-policy";
import type { createWorkspaceIdentityRequests } from "./request";

export function createInstallationIdentity(
  database: Database,
  {
    withIdentityRequest,
    lockWorkspaceMembership,
  }: ReturnType<typeof createWorkspaceIdentityRequests>,
) {
  return {
    policy: createInstallationIdentityPolicy(database),
    provider: {
      withIdentityRequest,
      beforeMembershipMutation: lockWorkspaceMembership,
      lockUserLifecycle: lockWorkspaceMembership,
      lockAccountDeletion: lockWorkspaceMembership,
      createSessionOnboardingHook: () => async () => {},
      identityAdapter: (executor) => drizzleAdapter(executor, { provider: "pg" }),
      organizationHooks: () => ({
        async beforeCreateOrganization() {
          throw new APIError("FORBIDDEN", {
            message: "This installation supports one workspace. Use initial setup to create it.",
          });
        },
      }),
    },
  } satisfies ApplicationIdentity;
}
