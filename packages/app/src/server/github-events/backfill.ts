/**
 * Backfill: replay historical GitHub Actions data through the collector pipeline.
 *
 * Fetches runs and jobs from the GitHub REST API for user-selected repos,
 * transforms them into webhook-compatible payloads, and enqueues each through
 * the same pg-boss queues used by live webhooks (gh-collector + gh-status).
 *
 * Scope constraints (from spec):
 * - User-selected repos (one or more)
 * - 100 jobs per repo (soft quota — a run that pushes past 100 is fully included)
 * - Branch selection: main → master → no filter (picks first with runs)
 * - Only runs with conclusion "success" or "failure"
 *
 * All GitHub API calls (repos, runs, jobs) are made sequentially on purpose to
 * stay well within GitHub's rate limits. The backfill runs in the background
 * during onboarding, so wall-clock time is acceptable.
 */

import { createHash, createHmac } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { workflowRuns } from "@/db/schema";
import { githubEnv } from "@/env/github";
import { getInstallationToken, paginate } from "./github-api";
import { enqueueWebhookEvent } from "./runtime";
import { generateWorkflowTraceId } from "./trace-id";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const JOB_QUOTA_PER_REPO = 100;
/** Try main, then master, then no branch filter. Stop at the first with runs. */
const BRANCH_CANDIDATES: (string | null)[] = ["main", "master", null];
const VALID_CONCLUSIONS = new Set(["success", "failure"]);

// ---------------------------------------------------------------------------
// GitHub API response types
// ---------------------------------------------------------------------------

export interface ApiRepo {
  id: number;
  full_name: string;
  html_url: string;
}

export interface ApiUser {
  login: string;
  id: number;
  node_id: string;
  avatar_url: string;
  gravatar_id: string;
  url: string;
  html_url: string;
  followers_url: string;
  following_url: string;
  gists_url: string;
  starred_url: string;
  subscriptions_url: string;
  organizations_url: string;
  repos_url: string;
  events_url: string;
  received_events_url: string;
  type: string;
  site_admin: boolean;
}

export interface ApiMinimalRepo {
  id: number;
  node_id?: string;
  name: string;
  full_name: string;
  private?: boolean;
  owner: ApiUser;
  html_url: string;
  description?: string | null;
  fork?: boolean;
  url?: string;
}

export interface ApiWorkflowRun {
  id: number;
  node_id: string;
  name: string | null;
  head_branch: string | null;
  head_sha: string;
  path: string;
  display_title: string;
  run_number: number;
  run_attempt: number;
  event: string;
  status: string;
  conclusion: string | null;
  workflow_id: number;
  check_suite_id: number;
  check_suite_node_id: string;
  url: string;
  html_url: string;
  jobs_url: string;
  logs_url: string;
  check_suite_url: string;
  artifacts_url: string;
  cancel_url: string;
  rerun_url: string;
  workflow_url: string;
  previous_attempt_url: string | null;
  pull_requests: Array<{
    id: number;
    number: number;
    url: string;
    head: {
      ref: string;
      sha: string;
      repo: { id: number; url: string; name: string };
    };
    base: {
      ref: string;
      sha: string;
      repo: { id: number; url: string; name: string };
    };
  }>;
  created_at: string;
  updated_at: string;
  run_started_at: string;
  actor: ApiUser | null;
  triggering_actor: ApiUser | null;
  head_commit: {
    id: string;
    tree_id: string;
    message: string;
    timestamp: string;
    author: { email: string | null; name: string | null } | null;
    committer: { email: string | null; name: string | null } | null;
  } | null;
  repository: ApiMinimalRepo;
  head_repository: ApiMinimalRepo;
  referenced_workflows: Array<{ path: string; sha: string; ref?: string }>;
}

export interface ApiWorkflowJobStep {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
  started_at: string | null;
  completed_at: string | null;
}

export interface ApiWorkflowJob {
  id: number;
  run_id: number;
  run_url: string;
  run_attempt: number;
  node_id: string;
  head_sha: string;
  head_branch: string | null;
  url: string;
  html_url: string | null;
  status: string;
  conclusion: string | null;
  created_at: string;
  started_at: string;
  completed_at: string | null;
  name: string;
  steps: ApiWorkflowJobStep[];
  check_run_url: string;
  labels: string[];
  runner_id: number | null;
  runner_name: string | null;
  runner_group_id: number | null;
  runner_group_name: string | null;
  workflow_name: string | null;
}

// ---------------------------------------------------------------------------
// REST API → collector body transformers
// ---------------------------------------------------------------------------

/**
 * Builds the raw JSON bytes to send to the Go collector for a workflow_run event.
 *
 * Injects `status` which the Go collector requires (`GetStatus() == "completed"`)
 * but the TypeScript Zod schema omits.
 */
export function apiRunToCollectorBody(
  run: ApiWorkflowRun,
  repo: ApiRepo,
  installationId: number,
): Buffer {
  const body = {
    action: "completed",
    installation: { id: installationId },
    // sender is webhook-only (not available from REST API) — approximate with triggering_actor
    sender: run.triggering_actor ?? run.actor ?? null,
    repository: {
      id: repo.id,
      name: repo.full_name.split("/")[1],
      full_name: repo.full_name,
      html_url: repo.html_url,
      owner: { login: repo.full_name.split("/")[0] },
    },
    workflow: {
      id: run.workflow_id,
      name: run.name,
      path: run.path,
    },
    workflow_run: {
      id: run.id,
      node_id: run.node_id,
      name: run.name,
      head_branch: run.head_branch,
      head_sha: run.head_sha,
      path: run.path,
      display_title: run.display_title,
      run_number: run.run_number,
      run_attempt: run.run_attempt,
      event: run.event,
      status: run.status,
      conclusion: run.conclusion,
      workflow_id: run.workflow_id,
      check_suite_id: run.check_suite_id,
      check_suite_node_id: run.check_suite_node_id,
      url: run.url,
      html_url: run.html_url,
      jobs_url: run.jobs_url,
      logs_url: run.logs_url,
      check_suite_url: run.check_suite_url,
      artifacts_url: run.artifacts_url,
      cancel_url: run.cancel_url,
      rerun_url: run.rerun_url,
      workflow_url: run.workflow_url,
      previous_attempt_url: run.previous_attempt_url,
      pull_requests: run.pull_requests,
      created_at: run.created_at,
      updated_at: run.updated_at,
      run_started_at: run.run_started_at,
      actor: run.actor,
      triggering_actor: run.triggering_actor,
      head_commit: run.head_commit,
      repository: run.repository,
      head_repository: run.head_repository,
      referenced_workflows: run.referenced_workflows,
    },
  };
  return Buffer.from(JSON.stringify(body), "utf8");
}

/**
 * Builds the raw JSON bytes to send to the Go collector for a workflow_job event.
 *
 * Uses `labels` (not `runner_labels`) because the Go collector's go-github
 * struct tag is `json:"labels"`.
 */
export function apiJobToCollectorBody(
  job: ApiWorkflowJob,
  repo: ApiRepo,
  installationId: number,
): Buffer {
  const body = {
    action: "completed",
    installation: { id: installationId },
    // sender is webhook-only — not available from the REST API jobs endpoint
    repository: {
      id: repo.id,
      name: repo.full_name.split("/")[1],
      full_name: repo.full_name,
      html_url: repo.html_url,
      owner: { login: repo.full_name.split("/")[0] },
    },
    workflow_job: {
      id: job.id,
      run_id: job.run_id,
      run_url: job.run_url,
      run_attempt: job.run_attempt,
      node_id: job.node_id,
      head_sha: job.head_sha,
      head_branch: job.head_branch,
      url: job.url,
      html_url: job.html_url,
      status: job.status,
      conclusion: job.conclusion,
      created_at: job.created_at,
      started_at: job.started_at,
      completed_at: job.completed_at,
      name: job.name,
      steps: job.steps,
      check_run_url: job.check_run_url,
      labels: job.labels,
      runner_id: job.runner_id,
      runner_name: job.runner_name,
      runner_group_id: job.runner_group_id,
      runner_group_name: job.runner_group_name,
      workflow_name: job.workflow_name,
      runner_labels: job.labels,
    },
  };
  return Buffer.from(JSON.stringify(body), "utf8");
}

// ---------------------------------------------------------------------------
// Webhook signature — the Go collector validates x-hub-signature-256
// ---------------------------------------------------------------------------

function deterministicUuid(input: string): string {
  const hash = createHash("sha256").update(input).digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join("-");
}

function signedHeaders(
  eventType: "workflow_run" | "workflow_job",
  body: Buffer,
) {
  const signature = `sha256=${createHmac("sha256", githubEnv.GITHUB_APP_WEBHOOK_SECRET).update(body).digest("hex")}`;
  return {
    "x-github-event": [eventType],
    "x-hub-signature-256": [signature],
    "content-type": ["application/json"],
  };
}

// ---------------------------------------------------------------------------
// Progress tracking
// ---------------------------------------------------------------------------

export interface BackfillResult {
  repo: string;
  runsReplayed: number;
  runsSkipped: number;
  jobsReplayed: number;
  errors: string[];
  durationMs: number;
}

export interface BackfillProgress {
  status: "importing" | "done";
  jobsEnqueued: number;
  jobsQuota: number;
  runsProcessed: number;
  errors?: string[];
}

// ---------------------------------------------------------------------------
// Deduplication — check which traceIds already exist
// ---------------------------------------------------------------------------

async function getExistingTraceIds(
  organizationId: string,
  traceIds: string[],
): Promise<Set<string>> {
  if (traceIds.length === 0) return new Set();

  const rows = await db
    .select({ traceId: workflowRuns.traceId })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.organizationId, organizationId),
        inArray(workflowRuns.traceId, traceIds),
      ),
    );

  return new Set(rows.map((r) => r.traceId));
}

// ---------------------------------------------------------------------------
// List installation repositories
// ---------------------------------------------------------------------------

export async function listInstallationRepos(
  installationId: number,
): Promise<ApiRepo[]> {
  const token = await getInstallationToken(installationId);
  const repos: ApiRepo[] = [];
  for await (const repo of paginate<ApiRepo>(
    token,
    "https://api.github.com/installation/repositories?per_page=100",
    "repositories",
  )) {
    repos.push(repo);
  }
  return repos;
}

// ---------------------------------------------------------------------------
// Main backfill entry point
// ---------------------------------------------------------------------------

/**
 * Backfills historical GitHub Actions data for a single repo.
 *
 * Tries main, then master, then no branch filter — stops at the first
 * that returns runs. Replays completed runs and their jobs through the
 * collector pipeline. Stops at 100 jobs per repo (soft quota).
 */
export async function* backfillRepo(
  installationId: number,
  organizationId: string,
  repo: ApiRepo,
): AsyncGenerator<BackfillProgress> {
  const started = Date.now();

  console.log(
    `[backfill] installation=${installationId} importing ${repo.full_name}`,
  );

  const result: BackfillResult = {
    repo: repo.full_name,
    runsReplayed: 0,
    jobsReplayed: 0,
    runsSkipped: 0,
    errors: [],
    durationMs: 0,
  };

  let jobCount = 0;
  let runsProcessed = 0;

  for (const branch of BRANCH_CANDIDATES) {
    if (jobCount >= JOB_QUOTA_PER_REPO) break;

    const branchParam = branch ? `&branch=${branch}` : "";
    const runsUrl = `https://api.github.com/repos/${repo.full_name}/actions/runs?status=completed${branchParam}&per_page=100`;

    try {
      const token = await getInstallationToken(installationId);

      // Collect all valid runs, then dedup in one query
      const candidateRuns: ApiWorkflowRun[] = [];
      for await (const run of paginate<ApiWorkflowRun>(
        token,
        runsUrl,
        "workflow_runs",
      )) {
        if (!VALID_CONCLUSIONS.has(run.conclusion ?? "")) continue;
        candidateRuns.push(run);
      }

      if (candidateRuns.length === 0) continue;

      const traceIds = candidateRuns.map((run) =>
        generateWorkflowTraceId(repo.id, run.id, run.run_attempt),
      );
      const existing = await getExistingTraceIds(organizationId, traceIds);

      yield {
        status: "importing",
        jobsEnqueued: result.jobsReplayed,
        jobsQuota: JOB_QUOTA_PER_REPO,
        runsProcessed,
      };

      for (let i = 0; i < candidateRuns.length; i++) {
        if (jobCount >= JOB_QUOTA_PER_REPO) break;
        const run = candidateRuns[i];

        if (existing.has(traceIds[i])) {
          result.runsSkipped++;
          continue;
        }

        try {
          // Enqueue job events BEFORE the run event so the collector's
          // step-timing cache is populated when eventToLogs processes the run.
          const jobsUrl = `https://api.github.com/repos/${repo.full_name}/actions/runs/${run.id}/jobs?per_page=100`;
          const freshToken = await getInstallationToken(installationId);

          for await (const job of paginate<ApiWorkflowJob>(
            freshToken,
            jobsUrl,
            "jobs",
          )) {
            if (job.status !== "completed") continue;

            try {
              const jobBody = apiJobToCollectorBody(job, repo, installationId);
              await enqueueWebhookEvent(
                deterministicUuid(
                  `backfill-${organizationId}-job-${job.id}-${job.run_attempt}`,
                ),
                {
                  headers: signedHeaders("workflow_job", jobBody),
                  body: jobBody.toString("base64"),
                },
              );
              result.jobsReplayed++;
              jobCount++;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              result.errors.push(`job ${job.id} in run ${run.id}: ${msg}`);
            }
          }

          const runBody = apiRunToCollectorBody(run, repo, installationId);
          await enqueueWebhookEvent(
            deterministicUuid(`backfill-${organizationId}-run-${traceIds[i]}`),
            {
              headers: signedHeaders("workflow_run", runBody),
              body: runBody.toString("base64"),
            },
          );
          result.runsReplayed++;
          runsProcessed++;
          yield {
            status: "importing",
            jobsEnqueued: result.jobsReplayed,
            jobsQuota: JOB_QUOTA_PER_REPO,
            runsProcessed,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`run ${run.id}: ${msg}`);
        }
      }

      // Found runs on this branch — don't try the next candidate
      break;
    } catch (err) {
      // Branch may not exist (404) — try next
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("status=404")) {
        result.errors.push(`branch ${branch ?? "all"}: ${msg}`);
      }
    }
  }

  result.durationMs = Date.now() - started;
  console.log(
    `[backfill] ${repo.full_name}: runs=${result.runsReplayed} skipped=${result.runsSkipped} jobs=${result.jobsReplayed} errors=${result.errors.length} duration=${result.durationMs}ms`,
  );

  yield {
    status: "done",
    jobsEnqueued: result.jobsReplayed,
    jobsQuota: JOB_QUOTA_PER_REPO,
    runsProcessed,
    errors: result.errors,
  };
}
