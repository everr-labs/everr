import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { githubInstallationOrganizations } from "@/db/schema";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import {
  backfillRepo,
  JOB_QUOTA_PER_REPO,
  listInstallationRepos,
} from "@/server/github-events/backfill";

async function getInstallationsForOrganization(organizationId: string) {
  return db
    .select({
      installationId: githubInstallationOrganizations.githubInstallationId,
      status: githubInstallationOrganizations.status,
      createdAt: githubInstallationOrganizations.createdAt,
      updatedAt: githubInstallationOrganizations.updatedAt,
    })
    .from(githubInstallationOrganizations)
    .where(eq(githubInstallationOrganizations.organizationId, organizationId));
}

export const getGithubAppInstallStatus = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context: { session } }) => {
  const installations = await getInstallationsForOrganization(
    session.session.activeOrganizationId,
  );

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
  const installations = await getInstallationsForOrganization(
    session.session.activeOrganizationId,
  );
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
    const installations = await getInstallationsForOrganization(
      session.session.activeOrganizationId,
    );
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
          session.session.activeOrganizationId,
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
