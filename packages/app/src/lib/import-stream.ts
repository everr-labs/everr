/**
 * Client-side helpers for consuming the streaming import server function.
 */

import { importRepoFn } from "@/data/onboarding";

export interface ImportProgress {
  jobsEnqueued: number;
  jobsQuota: number;
  runsProcessed: number;
}

export interface ImportResult {
  totalJobs: number;
  totalErrors: number;
}

/**
 * Imports a single repo by calling the streaming server function.
 * Returns cumulative job/error counts.
 */
async function importRepo({
  repoFullName,
  onProgress,
}: {
  repoFullName: string;
  onProgress: (progress: ImportProgress) => void;
}): Promise<{
  jobsEnqueued: number;
  runsProcessed: number;
  errors: number;
}> {
  const stream = await importRepoFn({ data: { repoFullName } });

  if (!stream) {
    throw new Error("Import request failed");
  }

  const reader = stream.getReader();
  let jobsEnqueued = 0;
  let runsProcessed = 0;
  let errors = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    onProgress({
      jobsEnqueued: value.jobsEnqueued,
      jobsQuota: value.jobsQuota,
      runsProcessed: value.runsProcessed,
    });

    if (value.status === "done") {
      jobsEnqueued = value.jobsEnqueued;
      runsProcessed = value.runsProcessed;
      errors = value.errors?.length ?? 0;
    }
  }

  return { jobsEnqueued, runsProcessed, errors };
}

/**
 * Imports multiple repos sequentially, calling callbacks for repo
 * transitions and progress updates.
 */
export async function importRepos({
  repos,
  onRepoStart,
  onProgress,
  onComplete,
}: {
  repos: string[];
  onRepoStart: (
    repoFullName: string,
    repoIndex: number,
    reposTotal: number,
  ) => void;
  onProgress: (progress: ImportProgress) => void;
  onComplete: () => void;
}): Promise<ImportResult> {
  let totalJobs = 0;
  let totalErrors = 0;

  let runsOffset = 0;
  const perRepoQuota = 100;
  const totalQuota = repos.length * perRepoQuota;

  for (let i = 0; i < repos.length; i++) {
    const repoFullName = repos[i];
    onRepoStart(repoFullName, i, repos.length);
    const jobsBase = i * perRepoQuota;
    const currentRunsOffset = runsOffset;
    const result = await importRepo({
      repoFullName,
      onProgress: (p) =>
        onProgress({
          jobsEnqueued: jobsBase + p.jobsEnqueued,
          jobsQuota: totalQuota,
          runsProcessed: currentRunsOffset + p.runsProcessed,
        }),
    });
    runsOffset += result.runsProcessed;
    totalJobs += result.jobsEnqueued;
    totalErrors += result.errors;
  }

  onComplete();
  return { totalJobs, totalErrors };
}
