import { createServerFn } from "@tanstack/react-start";
import {
  getAuth,
  switchToOrganization,
} from "@workos/authkit-tanstack-react-start";
import { z } from "zod";
import { CreateOrganizationInputSchema } from "@/common/organization-name";
import {
  ensureTenantForOrganizationId,
  getGithubInstallationsForTenant,
} from "@/data/tenants";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { workOS } from "@/lib/workos";
import {
  backfillRepo,
  JOB_QUOTA_PER_REPO,
  listInstallationRepos,
} from "@/server/github-events/backfill";

export type OnboardingErrorCode =
  | "UNAUTHENTICATED"
  | "ORG_CREATE_FAILED"
  | "MEMBERSHIP_CREATE_FAILED"
  | "SESSION_SWITCH_FAILED"
  | "TENANT_LINK_FAILED";

function createSafeOnboardingError(
  code: OnboardingErrorCode,
  requestId: string,
): Error {
  switch (code) {
    case "UNAUTHENTICATED":
      return new Error("You need to sign in before creating an organization.");
    case "ORG_CREATE_FAILED":
      return new Error(
        `We couldn't create your organization right now. Please try again. (ref: ${requestId})`,
      );
    case "MEMBERSHIP_CREATE_FAILED":
      return new Error(
        `Your organization was created, but we couldn't finish setup. Please try again. (ref: ${requestId})`,
      );
    case "SESSION_SWITCH_FAILED":
      return new Error(
        `Your organization was created, but we couldn't switch your session. Please try again. (ref: ${requestId})`,
      );
    case "TENANT_LINK_FAILED":
      return new Error(
        `Your organization is ready, but we couldn't finish tenant setup. Please try again. (ref: ${requestId})`,
      );
  }
}

export const createOrganizationForCurrentUser = createServerFn({
  method: "POST",
})
  .inputValidator(CreateOrganizationInputSchema)
  .handler(async ({ data }) => {
    const requestId = crypto.randomUUID();

    const auth = await getAuth();
    if (!auth.user) {
      throw createSafeOnboardingError("UNAUTHENTICATED", requestId);
    }

    if (auth.organizationId) {
      try {
        await ensureTenantForOrganizationId(auth.organizationId);
      } catch (error) {
        console.error("[onboarding] tenant_link_failed_existing_org", {
          requestId,
          userId: auth.user.id,
          organizationId: auth.organizationId,
          error,
        });
        throw createSafeOnboardingError("TENANT_LINK_FAILED", requestId);
      }

      return {
        organizationId: auth.organizationId,
        organizationName: data.organizationName,
      };
    }

    let organizationId: string;

    try {
      const organization = await workOS.organizations.createOrganization({
        name: data.organizationName,
        metadata: {
          onboardingCompleted: "false",
        },
      });
      organizationId = organization.id;
    } catch (error) {
      console.error("[onboarding] org_create_failed", {
        requestId,
        userId: auth.user.id,
        organizationName: data.organizationName,
        error,
      });
      throw createSafeOnboardingError("ORG_CREATE_FAILED", requestId);
    }

    try {
      await workOS.userManagement.createOrganizationMembership({
        organizationId,
        userId: auth.user.id,
        roleSlug: "admin",
      });
    } catch (error) {
      console.error("[onboarding] membership_create_failed", {
        requestId,
        userId: auth.user.id,
        organizationId,
        error,
      });
      throw createSafeOnboardingError("MEMBERSHIP_CREATE_FAILED", requestId);
    }

    try {
      await switchToOrganization({
        data: { organizationId },
      });
    } catch (error) {
      console.error("[onboarding] session_switch_failed", {
        requestId,
        userId: auth.user.id,
        organizationId,
        error,
      });
      throw createSafeOnboardingError("SESSION_SWITCH_FAILED", requestId);
    }

    try {
      await ensureTenantForOrganizationId(organizationId);
    } catch (error) {
      console.error("[onboarding] tenant_link_failed_new_org", {
        requestId,
        userId: auth.user.id,
        organizationId,
        error,
      });
      throw createSafeOnboardingError("TENANT_LINK_FAILED", requestId);
    }

    return {
      organizationId,
      organizationName: data.organizationName,
    };
  });

export const getGithubAppInstallStatus = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context: { session } }) => {
  const tenantId = await ensureTenantForOrganizationId(session.organizationId);
  const installations = await getGithubInstallationsForTenant(tenantId);

  return installations.map((installation) => ({
    installed: installation.status === "active",
    installationId: installation.installationId,
    installedAt: installation.createdAt,
    status: installation.status,
  }));
});

export const getInstallationRepos = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context: { session } }) => {
  const tenantId = await ensureTenantForOrganizationId(session.organizationId);
  const installations = await getGithubInstallationsForTenant(tenantId);
  const active = installations.find((i) => i.status === "active");

  if (!active) {
    return [];
  }

  const repos = await listInstallationRepos(active.installationId);
  return repos.map((r) => ({ id: r.id, fullName: r.full_name }));
});

export const importRepos = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(z.object({ repos: z.array(z.string().min(1)).min(1) }))
  .handler(async function* ({ data, context: { session } }) {
    const tenantId = await ensureTenantForOrganizationId(
      session.organizationId,
    );
    const installations = await getGithubInstallationsForTenant(tenantId);
    const active = installations.find((i) => i.status === "active");
    if (!active) {
      throw new Error("No active GitHub installation found");
    }

    const allRepos = await listInstallationRepos(active.installationId);
    const repos = data.repos
      .map((name) => allRepos.find((r) => r.full_name === name))
      .filter((r) => r != null);

    const totalQuota = repos.length * JOB_QUOTA_PER_REPO;
    let totalJobs = 0;
    let totalErrors = 0;
    let runsOffset = 0;

    for (let i = 0; i < repos.length; i++) {
      const repo = repos[i];
      yield {
        type: "repo-start" as const,
        repoFullName: repo.full_name,
        repoIndex: i,
        reposTotal: repos.length,
      };

      const jobsBase = i * JOB_QUOTA_PER_REPO;
      const currentRunsOffset = runsOffset;

      try {
        for await (const update of backfillRepo(
          active.installationId,
          tenantId,
          repo,
        )) {
          yield {
            type: "progress" as const,
            progress: {
              jobsEnqueued: jobsBase + update.jobsEnqueued,
              jobsQuota: totalQuota,
              runsProcessed: currentRunsOffset + update.runsProcessed,
            },
          };
          if (update.status === "done") {
            runsOffset += update.runsProcessed;
            totalJobs += update.jobsEnqueued;
            totalErrors += update.errors?.length ?? 0;
          }
        }
      } catch (err) {
        console.error(`[import] failed to import ${repo.full_name}`, err);
        totalErrors++;
        yield {
          type: "repo-error" as const,
          repoFullName: repo.full_name,
        };
      }
    }

    yield { type: "done" as const, totalJobs, totalErrors };
  });

export const ensureOrganizationForDevice = createServerFn({
  method: "POST",
}).handler(async () => {
  const auth = await getAuth();
  if (!auth.user) {
    throw new Error("unauthenticated");
  }

  if (auth.organizationId) {
    // Already has org in session — nothing to do.
    return { isNewOrg: false };
  }

  // Check if the user is already a member of any org.
  const memberships = await workOS.userManagement.listOrganizationMemberships({
    userId: auth.user.id,
  });

  if (memberships.data.length > 0) {
    // Switch to the most recently created org.
    const sorted = [...memberships.data].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    await switchToOrganization({
      data: { organizationId: sorted[0].organizationId },
    });
    return { isNewOrg: false };
  }

  // No orgs — create a placeholder.
  const user = await workOS.userManagement.getUser(auth.user.id);
  const firstName = user.firstName ?? user.email.split("@")[0];
  const orgName = `${firstName}'s workspace`;

  const organization = await workOS.organizations.createOrganization({
    name: orgName,
    metadata: { onboardingCompleted: "false" },
  });

  await workOS.userManagement.createOrganizationMembership({
    organizationId: organization.id,
    userId: auth.user.id,
    roleSlug: "admin",
  });

  await switchToOrganization({ data: { organizationId: organization.id } });
  await ensureTenantForOrganizationId(organization.id);

  return { isNewOrg: true };
});
