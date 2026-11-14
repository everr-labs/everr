import { and, eq } from "drizzle-orm";
import { db } from "#app/db/client.ts";
import { githubInstallationOrganizations } from "#app/db/schema/index.ts";
import {
  getAppSlug,
  getInstallationToken,
  getRepositoryInstallationId,
} from "#app/server/github-events/github-api.ts";
import { ChannelSendError, isPermanentStatus } from "./outbound";

const GITHUB_API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 10_000;

export type GithubIssueState = {
  state: "open" | "closed";
  /** Why it was closed: `not_planned` is a person deciding against the work. */
  stateReason: string | null;
  closedAt: Date | null;
};

/** The repository part of a repoid inferred from a GitHub remote
 *  (`github.com/owner/name`), or null for any other repoid. */
export function githubRepoFromRepoid(repoid: string): string | null {
  const match = /^github\.com\/([^/]+\/[^/]+)$/i.exec(repoid.trim());
  return match ? match[1] : null;
}

function isRateLimited(response: Response): boolean {
  return (
    response.status === 429 ||
    (response.status === 403 &&
      (response.headers.get("retry-after") !== null ||
        response.headers.get("x-ratelimit-remaining") === "0"))
  );
}

/**
 * One GitHub REST call with the outcome classified for the send job. The
 * response body is never quoted: it can echo the request, and this text is
 * stored in the delivery trail.
 */
async function githubRequest<T>(
  token: string,
  path: string,
  label: string,
  write?: { method: "POST" | "PATCH"; body: unknown },
): Promise<T> {
  let response: Response;
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    response =
      write === undefined
        ? await fetch(`${GITHUB_API}${path}`, { headers, signal })
        : await fetch(`${GITHUB_API}${path}`, {
            method: write.method,
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify(write.body),
            signal,
          });
  } catch {
    throw new ChannelSendError(`GitHub ${label} failed: network`, { permanent: false });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new ChannelSendError(`GitHub ${label} failed: ${response.status}`, {
      permanent: !isRateLimited(response) && isPermanentStatus(response.status),
      status: response.status,
    });
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- The GitHub REST contract for this endpoint; callers read only documented fields.
  return (await response.json()) as T;
}

/**
 * A token for writing issues in `repo`, after checking that the installation
 * reaching it belongs to this organization. Without that check, any org could
 * name another org's repository and have Everr write there.
 */
export async function githubIssueToken(organizationId: string, repo: string): Promise<string> {
  let installationId: number | null;
  try {
    installationId = await getRepositoryInstallationId(repo);
  } catch {
    throw new ChannelSendError("GitHub installation lookup failed", { permanent: false });
  }
  if (installationId === null) {
    throw new ChannelSendError(`the Everr GitHub App is not installed on ${repo}`, {
      permanent: true,
    });
  }
  const [installation] = await db
    .select({ status: githubInstallationOrganizations.status })
    .from(githubInstallationOrganizations)
    .where(
      and(
        eq(githubInstallationOrganizations.githubInstallationId, installationId),
        eq(githubInstallationOrganizations.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!installation || installation.status !== "active") {
    throw new ChannelSendError(
      `${repo} is not reachable through this organization's GitHub installation`,
      { permanent: true },
    );
  }
  try {
    return await getInstallationToken(installationId);
  } catch {
    throw new ChannelSendError("GitHub installation token request failed", { permanent: false });
  }
}

export async function hasActiveGithubInstallation(organizationId: string): Promise<boolean> {
  const [installation] = await db
    .select({ id: githubInstallationOrganizations.githubInstallationId })
    .from(githubInstallationOrganizations)
    .where(
      and(
        eq(githubInstallationOrganizations.organizationId, organizationId),
        eq(githubInstallationOrganizations.status, "active"),
      ),
    )
    .limit(1);
  return installation !== undefined;
}

/**
 * Issues carry error messages, stack traces and evidence rows from
 * production. A public repository would publish them, so Everr refuses to
 * write there.
 */
export async function assertPrivateRepository(token: string, repo: string): Promise<void> {
  const data = await githubRequest<{ private: boolean }>(
    token,
    `/repos/${repo}`,
    "repository read",
  );
  if (!data.private) {
    throw new ChannelSendError(`${repo} is public, and alert issues can contain production data`, {
      permanent: true,
    });
  }
}

/** How many open issues the App itself opened in `repo` with all of `labels`. */
export async function countOpenAppIssues(
  token: string,
  repo: string,
  labels: string[],
  limit: number,
): Promise<number> {
  let slug: string;
  try {
    slug = await getAppSlug();
  } catch {
    throw new ChannelSendError("GitHub App lookup failed", { permanent: false });
  }
  const query = new URLSearchParams({
    state: "open",
    creator: `${slug}[bot]`,
    per_page: String(Math.min(100, limit)),
  });
  if (labels.length > 0) query.set("labels", labels.join(","));
  const issues = await githubRequest<{ pull_request?: unknown }[]>(
    token,
    `/repos/${repo}/issues?${query}`,
    "issue list",
  );
  // The issues endpoint also lists pull requests.
  return issues.filter((issue) => issue.pull_request === undefined).length;
}

export async function createGithubIssue(
  token: string,
  repo: string,
  issue: { title: string; body: string; labels: string[]; assignees: string[] },
): Promise<{ number: number; url: string }> {
  const created = await githubRequest<{ number: number; html_url: string }>(
    token,
    `/repos/${repo}/issues`,
    "issue create",
    { method: "POST", body: issue },
  );
  return { number: created.number, url: created.html_url };
}

export async function getGithubIssueState(
  token: string,
  repo: string,
  issueNumber: number,
): Promise<GithubIssueState> {
  const issue = await githubRequest<{
    state: "open" | "closed";
    state_reason: string | null;
    closed_at: string | null;
  }>(token, `/repos/${repo}/issues/${issueNumber}`, "issue read");
  return {
    state: issue.state,
    stateReason: issue.state_reason,
    closedAt: issue.closed_at ? new Date(issue.closed_at) : null,
  };
}

export async function reopenGithubIssue(
  token: string,
  repo: string,
  issueNumber: number,
): Promise<void> {
  await githubRequest(token, `/repos/${repo}/issues/${issueNumber}`, "issue reopen", {
    method: "PATCH",
    body: { state: "open" },
  });
}

export async function commentOnGithubIssue(
  token: string,
  repo: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  await githubRequest(token, `/repos/${repo}/issues/${issueNumber}/comments`, "issue comment", {
    method: "POST",
    body: { body },
  });
}
