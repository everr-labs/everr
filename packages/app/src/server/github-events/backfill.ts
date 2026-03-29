/**
 * Backfill: replay historical GitHub Actions data through the collector pipeline.
 *
 * Fetches runs and jobs from the GitHub REST API for user-selected repos,
 * transforms them into webhook-compatible payloads, and enqueues each through
 * the same pg-boss queues used by live webhooks (gh-collector + gh-status).
 *
 * Scope constraints (from spec):
 * - User-selected repos (one or more)
 * - 50 jobs per repo (soft quota — a run that pushes past 50 is fully included)
 * - Default branches only: main → master → develop (queried in order, stops early)
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

const JOB_QUOTA_PER_REPO = 50;
const BRANCHES = ["main", "master", "develop"] as const;
const VALID_CONCLUSIONS = new Set(["success", "failure"]);

// ---------------------------------------------------------------------------
// GitHub API response types
// ---------------------------------------------------------------------------

export interface ApiRepo {
  id: number;
  full_name: string;
  html_url: string;
}

export interface ApiWorkflowRun {
  id: number;
  name: string | null;
  html_url: string;
  head_branch: string | null;
  head_sha: string;
  conclusion: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  run_started_at: string | null;
  run_attempt: number;
  run_number: number;
  event: string;
  workflow_id: number;
  display_title: string | null;
  path?: string | null;
  previous_attempt_url: string | null;
  referenced_workflows: Array<{ path: string; sha: string; ref?: string }>;
  actor: { login: string } | null;
  triggering_actor: { login: string } | null;
  head_commit: {
    id: string;
    tree_id: string;
    message: string;
    timestamp: string;
    author: { email: string | null; name: string | null } | null;
    committer: { email: string | null; name: string | null } | null;
  } | null;
  pull_requests: Array<{ number: number }> | null;
  head_repository: { full_name: string } | null;
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
  run_attempt: number;
  name: string;
  html_url: string;
  head_branch: string | null;
  head_sha: string;
  conclusion: string | null;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  workflow_name: string | null;
  runner_name: string | null;
  labels: string[];
  runner_group_name: string | null;
  check_run_url: string | null;
  steps: ApiWorkflowJobStep[];
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
      path: run.path ?? null,
    },
    workflow_run: {
      id: run.id,
      run_attempt: run.run_attempt,
      name: run.name,
      html_url: run.html_url,
      head_commit: run.head_commit ?? null,
      head_branch: run.head_branch,
      head_sha: run.head_sha,
      conclusion: run.conclusion,
      status: run.status,
      created_at: run.created_at,
      updated_at: run.updated_at,
      run_started_at: run.run_started_at,
      event: run.event,
      workflow_id: run.workflow_id,
      display_title: run.display_title,
      run_number: run.run_number,
      path: run.path ?? null,
      previous_attempt_url: run.previous_attempt_url ?? null,
      referenced_workflows: run.referenced_workflows ?? [],
      actor: run.actor ?? null,
      triggering_actor: run.triggering_actor ?? null,
      pull_requests: run.pull_requests ?? null,
      head_repository: run.head_repository ?? null,
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
      run_attempt: job.run_attempt,
      name: job.name,
      html_url: job.html_url,
      head_branch: job.head_branch,
      head_sha: job.head_sha,
      conclusion: job.conclusion,
      status: job.status,
      created_at: job.created_at,
      started_at: job.started_at,
      completed_at: job.completed_at,
      workflow_name: job.workflow_name,
      runner_name: job.runner_name,
      labels: job.labels ?? [],
      runner_labels: job.labels ?? [],
      runner_group_name: job.runner_group_name,
      check_run_url: job.check_run_url,
      steps: job.steps ?? [],
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

// ---------------------------------------------------------------------------
// Deduplication — check which traceIds already exist
// ---------------------------------------------------------------------------

async function getExistingTraceIds(
  tenantId: number,
  traceIds: string[],
): Promise<Set<string>> {
  if (traceIds.length === 0) return new Set();

  const rows = await db
    .select({ traceId: workflowRuns.traceId })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.tenantId, tenantId),
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
 * Queries branches in order (main → master → develop), fetches completed runs
 * with conclusion success/failure, replays them and their jobs through the
 * collector. Stops at 50 jobs per repo (soft quota).
 */
export async function backfillRepo(
  installationId: number,
  tenantId: number,
  repo: ApiRepo,
): Promise<BackfillResult> {
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

  for (const branch of BRANCHES) {
    if (jobCount >= JOB_QUOTA_PER_REPO) break;

    const runsUrl = `https://api.github.com/repos/${repo.full_name}/actions/runs?status=completed&branch=${branch}&per_page=100`;

    try {
      const token = await getInstallationToken(installationId);

      // Collect all valid runs for this branch, then dedup in one query
      const candidateRuns: ApiWorkflowRun[] = [];
      for await (const run of paginate<ApiWorkflowRun>(
        token,
        runsUrl,
        "workflow_runs",
      )) {
        if (!VALID_CONCLUSIONS.has(run.conclusion ?? "")) continue;
        candidateRuns.push(run);
      }

      const traceIds = candidateRuns.map((run) =>
        generateWorkflowTraceId(repo.id, run.id, run.run_attempt),
      );
      const existing = await getExistingTraceIds(tenantId, traceIds);

      for (let i = 0; i < candidateRuns.length; i++) {
        if (jobCount >= JOB_QUOTA_PER_REPO) break;
        const run = candidateRuns[i];

        if (existing.has(traceIds[i])) {
          result.runsSkipped++;
          continue;
        }

        try {
          const runBody = apiRunToCollectorBody(run, repo, installationId);
          await enqueueWebhookEvent(
            deterministicUuid(`backfill-run-${traceIds[i]}`),
            {
              headers: signedHeaders("workflow_run", runBody),
              body: runBody.toString("base64"),
            },
          );
          result.runsReplayed++;

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
                deterministicUuid(`backfill-job-${job.id}-${job.run_attempt}`),
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
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`run ${run.id}: ${msg}`);
        }
      }
    } catch (err) {
      // Branch may not exist (404) — skip silently
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("status=404")) {
        result.errors.push(`branch ${branch}: ${msg}`);
      }
    }
  }

  result.durationMs = Date.now() - started;
  console.log(
    `[backfill] ${repo.full_name}: runs=${result.runsReplayed} skipped=${result.runsSkipped} jobs=${result.jobsReplayed} errors=${result.errors.length} duration=${result.durationMs}ms`,
  );

  return result;
}
