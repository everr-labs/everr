import { and, desc, eq, like, max } from "drizzle-orm";
import { ENVIRONMENT_SQL } from "#app/data/error-issues/detection.ts";
import { db } from "#app/db/client.ts";
import {
  githubInstallationOrganizations,
  serviceRepositories,
  workflowRuns,
} from "#app/db/schema/index.ts";
import { query } from "#app/lib/clickhouse.ts";
import { listInstallationRepos } from "#app/server/github-events/backfill.ts";
import { exceptionAttributes, serverLogger } from "#app/telemetry/logger.ts";
import {
  heldIssueCounts,
  releaseHeldIssues,
} from "#app/data/alerting/delivery/held-issues.server.ts";
import { commitSha, GithubRepositorySchema, githubRepoFromName, githubRepoFromUrl } from "./infer";

/** How Everr knows a service's repository. */
export type ServiceRepositorySource =
  /** Someone picked it. */
  | "set"
  /** `vcs.repository.name` or `vcs.repository.url.full`. */
  | "attribute"
  /** The `service.version` is a commit Everr saw built in CI. */
  | "commit"
  /** The organization has CI in one repository only. */
  | "only_repository";

export type ServiceRepositoryLink = {
  service: string;
  repository: string | null;
  source: ServiceRepositorySource | null;
  /** Issues for this service's errors waiting for its repository. */
  held: number;
};

/** What a service's telemetry says about where its code lives. */
export type ServiceSignals = {
  service: string;
  repositoryName?: string;
  repositoryUrl?: string;
  serviceVersion?: string;
};

// How far back the services list looks.
const SERVICES_LOOKBACK_DAYS = 7;
const SERVICES_LIMIT = 200;

/** The repositories Everr has seen CI from for this organization, most recent
 *  first. Inference reads only these, so a guess always names a repository
 *  with real activity. */
async function knownRepositories(organizationId: string): Promise<string[]> {
  const rows = await db
    .select({ repository: workflowRuns.repository, last: max(workflowRuns.lastEventAt) })
    .from(workflowRuns)
    .where(eq(workflowRuns.organizationId, organizationId))
    .groupBy(workflowRuns.repository)
    .orderBy(desc(max(workflowRuns.lastEventAt)));
  return rows.map((row) => row.repository).filter((repo) => repo !== "");
}

async function repoForCommit(organizationId: string, sha: string): Promise<string | null> {
  const [run] = await db
    .select({ repository: workflowRuns.repository })
    .from(workflowRuns)
    .where(and(eq(workflowRuns.organizationId, organizationId), like(workflowRuns.sha, `${sha}%`)))
    .orderBy(desc(workflowRuns.lastEventAt))
    .limit(1);
  return run?.repository || null;
}

async function savedRepository(organizationId: string, service: string): Promise<string | null> {
  const [row] = await db
    .select({ repository: serviceRepositories.repository })
    .from(serviceRepositories)
    .where(
      and(
        eq(serviceRepositories.organizationId, organizationId),
        eq(serviceRepositories.serviceName, service),
      ),
    )
    .limit(1);
  return row?.repository ?? null;
}

/**
 * Work a repository out from what the service sends, without a saved choice:
 * its repository attributes, then the commit in `service.version`, then the
 * organization's only repository.
 */
async function inferRepository(
  organizationId: string,
  signals: ServiceSignals,
  known: readonly string[],
): Promise<{ repository: string; source: ServiceRepositorySource } | null> {
  const fromUrl = signals.repositoryUrl ? githubRepoFromUrl(signals.repositoryUrl) : null;
  const fromName = signals.repositoryName
    ? githubRepoFromName(signals.repositoryName, known)
    : null;
  const fromAttribute = fromUrl ?? fromName;
  if (fromAttribute) return { repository: fromAttribute, source: "attribute" };
  const sha = signals.serviceVersion ? commitSha(signals.serviceVersion) : null;
  const fromCommit = sha ? await repoForCommit(organizationId, sha) : null;
  if (fromCommit) return { repository: fromCommit, source: "commit" };
  if (known.length === 1) return { repository: known[0], source: "only_repository" };
  return null;
}

/**
 * The repository a service's code lives in. A saved choice wins; otherwise
 * Everr works it out from the service's telemetry and the organization's CI.
 */
export async function repositoryForService(
  organizationId: string,
  signals: ServiceSignals,
): Promise<{ repository: string; source: ServiceRepositorySource } | null> {
  const saved = signals.service ? await savedRepository(organizationId, signals.service) : null;
  if (saved) return { repository: saved, source: "set" };
  const known = await knownRepositories(organizationId);
  const fromAlert = await inferRepository(organizationId, signals, known);
  if (fromAlert?.source === "attribute" || fromAlert?.source === "commit") return fromAlert;
  // The alert's row may not carry the service's repository attributes, for
  // a rule that does not select them. The service's own recent logs do.
  if (signals.service) {
    const [observed] = await observedServices(organizationId, { service: signals.service });
    const fromLogs = observed ? await inferRepository(organizationId, observed, known) : null;
    if (fromLogs) return fromLogs;
  }
  return fromAlert;
}

type ObservedServiceRow = {
  service: string;
  repository_name: string;
  repository_url: string;
  service_version: string;
};

/** Services that logged recently, with what their telemetry says about their code. */
async function observedServices(
  organizationId: string,
  only: { environment?: string; service?: string },
): Promise<ServiceSignals[]> {
  const params: Record<string, string> = {};
  const filters: string[] = [];
  if (only.environment) {
    filters.push(`AND ${ENVIRONMENT_SQL} = {environment:String}`);
    params.environment = only.environment;
  }
  if (only.service) {
    filters.push("AND ServiceName = {service:String}");
    params.service = only.service;
  }
  const latest = (key: string) =>
    `argMaxIf(toString(ResourceAttributes.\`${key}\`), Timestamp, toString(ResourceAttributes.\`${key}\`) != '')`;
  const rows = await query<ObservedServiceRow>(
    `SELECT
  ServiceName AS service,
  ${latest("vcs.repository.name")} AS repository_name,
  ${latest("vcs.repository.url.full")} AS repository_url,
  ${latest("service.version")} AS service_version
FROM logs
WHERE Timestamp >= now() - INTERVAL ${SERVICES_LOOKBACK_DAYS} DAY
  AND ServiceName != ''
  -- CI telemetry describes pipelines, not services.
  AND NOT has(ResourceAttributesKeys, 'cicd.pipeline.run.id')
  ${filters.join("\n  ")}
GROUP BY ServiceName
ORDER BY ServiceName
LIMIT ${SERVICES_LIMIT}`,
    organizationId,
    params,
  );
  return rows.map((row) => ({
    service: row.service,
    repositoryName: row.repository_name,
    repositoryUrl: row.repository_url,
    serviceVersion: row.service_version,
  }));
}

/**
 * The repositories the organization's GitHub App installations can reach, for
 * picking by hand. Empty when the App is not installed or GitHub does not
 * answer: the picker then offers the repositories seen in CI alone.
 */
async function installedRepositories(organizationId: string): Promise<string[]> {
  const installations = await db
    .select({ id: githubInstallationOrganizations.githubInstallationId })
    .from(githubInstallationOrganizations)
    .where(
      and(
        eq(githubInstallationOrganizations.organizationId, organizationId),
        eq(githubInstallationOrganizations.status, "active"),
      ),
    );
  if (installations.length === 0) return [];
  try {
    const lists = await Promise.all(
      installations.map((installation) => listInstallationRepos(installation.id)),
    );
    return lists.flat().map((repo) => repo.full_name);
  } catch (cause) {
    serverLogger.warn("service_repositories.installation_repos_failed", {
      ...exceptionAttributes(cause),
      "everr.organization.id": organizationId,
    });
    return [];
  }
}

/**
 * Every service that logged recently, in the environment when one is given,
 * with its repository. Services linked by hand, or with issues waiting for a
 * repository, are listed even when they did not log there.
 */
export async function serviceRepositoryLinks(
  organizationId: string,
  environment?: string,
): Promise<{ links: ServiceRepositoryLink[]; repositories: string[] }> {
  const [observed, saved, known, installed, held] = await Promise.all([
    observedServices(organizationId, { environment }),
    db
      .select({
        service: serviceRepositories.serviceName,
        repository: serviceRepositories.repository,
      })
      .from(serviceRepositories)
      .where(eq(serviceRepositories.organizationId, organizationId)),
    knownRepositories(organizationId),
    installedRepositories(organizationId),
    heldIssueCounts(organizationId),
  ]);
  const savedByService = new Map(saved.map((row) => [row.service, row.repository]));
  const signals = new Map(observed.map((row) => [row.service, row]));
  const unobserved = environment ? [...held.keys()] : [...savedByService.keys(), ...held.keys()];
  for (const service of unobserved) {
    if (!signals.has(service)) signals.set(service, { service });
  }
  const links = await Promise.all(
    [...signals.values()].map(async (row): Promise<ServiceRepositoryLink> => {
      const waiting = held.get(row.service) ?? 0;
      const set = savedByService.get(row.service);
      if (set) return { service: row.service, repository: set, source: "set", held: waiting };
      const inferred = await inferRepository(organizationId, row, known);
      return {
        service: row.service,
        repository: inferred?.repository ?? null,
        source: inferred?.source ?? null,
        held: waiting,
      };
    }),
  );
  links.sort((a, b) => a.service.localeCompare(b.service));
  const repositories = [...new Set([...known, ...[...installed].sort()])];
  return { links, repositories };
}

/** Link a service to a repository by hand, or, with null, go back to what
 *  Everr works out. Issues waiting for the repository are sent; returns how
 *  many. */
export async function setServiceRepository(
  organizationId: string,
  userId: string,
  service: string,
  repository: string | null,
): Promise<{ sent: number }> {
  const where = and(
    eq(serviceRepositories.organizationId, organizationId),
    eq(serviceRepositories.serviceName, service),
  );
  if (repository === null) {
    await db.delete(serviceRepositories).where(where);
    return { sent: 0 };
  }
  const repo = GithubRepositorySchema.parse(repository);
  const now = new Date();
  await db
    .insert(serviceRepositories)
    .values({ organizationId, serviceName: service, repository: repo, updatedBy: userId })
    .onConflictDoUpdate({
      target: [serviceRepositories.organizationId, serviceRepositories.serviceName],
      set: { repository: repo, updatedBy: userId, updatedAt: now },
    });
  return { sent: await releaseHeldIssues(organizationId, service) };
}
