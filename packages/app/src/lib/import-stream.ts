/**
 * Client-side NDJSON stream reader for the onboarding import endpoint.
 */

export interface ImportProgress {
  jobsEnqueued: number;
  jobsQuota: number;
  runsProcessed: number;
}

export interface ImportResult {
  totalJobs: number;
  totalErrors: number;
}

interface ImportRepoOptions {
  repoFullName: string;
  onProgress: (progress: ImportProgress) => void;
  fetchFn?: typeof fetch;
}

/**
 * Imports a single repo by calling the streaming endpoint and reading
 * NDJSON progress events. Returns cumulative job/error counts.
 */
export async function importRepo({
  repoFullName,
  onProgress,
  fetchFn = fetch,
}: ImportRepoOptions): Promise<{ jobsEnqueued: number; errors: number }> {
  const response = await fetchFn("/api/onboarding/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoFullName }),
  });

  if (!response.ok || !response.body) {
    throw new Error("Import request failed");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let jobsEnqueued = 0;
  let errors = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const update = JSON.parse(line);
      onProgress({
        jobsEnqueued: update.jobsEnqueued,
        jobsQuota: update.jobsQuota,
        runsProcessed: update.runsProcessed,
      });
      if (update.status === "done") {
        jobsEnqueued = update.jobsEnqueued;
        errors = update.errors?.length ?? 0;
      }
    }
  }

  return { jobsEnqueued, errors };
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
  fetchFn,
}: {
  repos: string[];
  onRepoStart: (
    repoFullName: string,
    repoIndex: number,
    reposTotal: number,
  ) => void;
  onProgress: (progress: ImportProgress) => void;
  onComplete: () => void;
  fetchFn?: typeof fetch;
}): Promise<ImportResult> {
  let totalJobs = 0;
  let totalErrors = 0;

  for (let i = 0; i < repos.length; i++) {
    const repoFullName = repos[i];
    onRepoStart(repoFullName, i, repos.length);
    const result = await importRepo({ repoFullName, onProgress, fetchFn });
    totalJobs += result.jobsEnqueued;
    totalErrors += result.errors;
  }

  onComplete();
  return { totalJobs, totalErrors };
}
