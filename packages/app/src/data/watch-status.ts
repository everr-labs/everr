import { z } from "zod";

export interface WatchRun {
  runId: string;
  runAttempt: number;
  workflowName: string;
  htmlUrl: string;
  status: string;
  conclusion: string | null;
  lastEventTime: string;
  durationSeconds: number;
  usualDurationSeconds: number | null;
  usualDurationSampleSize: number;
  activeJobs: string[];
}

export interface WatchJob {
  jobId: string;
  jobName: string;
  runAttempt: number;
  status: string;
  conclusion: string | null;
  lastEventTime: string;
  durationSeconds: number;
  pipelineRunId: string;
}

export interface WatchStatusResult {
  repo: string;
  branch: string;
  commit: string;
  pipelineFound: boolean;
  activeRuns: WatchRun[];
  completedRuns: WatchRun[];
}

export const WatchStatusInputSchema = z.object({
  repo: z.string().min(1),
  branch: z.string().min(1),
  commit: z.string().min(1),
});

export interface WatchRow {
  subjectId: string;
  runAttempt: number;
  subjectName: string;
  htmlUrl: string;
  status: string;
  conclusion: string | null;
  lastEventTime: string;
  eventKind: string;
  pipelineRunId: string;
  durationSeconds: string;
}

export interface WatchDurationBaseline {
  durationSeconds: number;
  sampleSize: number;
}

function watchRunKey(runId: string, runAttempt: number): string {
  return `${runId}:${runAttempt}`;
}

export function buildWatchStatus(
  data: z.infer<typeof WatchStatusInputSchema>,
  rows: WatchRow[],
  durationBaselinesByWorkflow = new Map<string, WatchDurationBaseline>(),
): WatchStatusResult {
  const jobs: WatchJob[] = rows
    .filter(
      (row) => row.eventKind === "taskrun" || row.eventKind === "workflowjob",
    )
    .map((row) => ({
      jobId: row.subjectId,
      jobName: row.subjectName,
      runAttempt: row.runAttempt,
      status: row.status,
      conclusion: row.conclusion,
      lastEventTime: row.lastEventTime,
      durationSeconds: Number(row.durationSeconds),
      pipelineRunId: row.pipelineRunId,
    }));

  const activeJobsByRunId = new Map<string, string[]>();
  for (const job of jobs) {
    if (job.status === "completed") {
      continue;
    }

    const runKey = watchRunKey(job.pipelineRunId, job.runAttempt);
    const activeJobs = activeJobsByRunId.get(runKey);
    if (activeJobs) {
      activeJobs.push(job.jobName);
    } else {
      activeJobsByRunId.set(runKey, [job.jobName]);
    }
  }

  const runs: WatchRun[] = rows
    .filter((row) => row.eventKind === "pipelinerun")
    .map((row) => {
      const baseline = durationBaselinesByWorkflow.get(row.subjectName);

      return {
        runId: row.subjectId,
        runAttempt: row.runAttempt,
        workflowName: row.subjectName,
        htmlUrl: row.htmlUrl,
        status: row.status,
        conclusion: row.conclusion,
        lastEventTime: row.lastEventTime,
        durationSeconds: Number(row.durationSeconds),
        usualDurationSeconds: baseline?.durationSeconds ?? null,
        usualDurationSampleSize: baseline?.sampleSize ?? 0,
        activeJobs:
          activeJobsByRunId.get(watchRunKey(row.subjectId, row.runAttempt)) ??
          [],
      };
    });

  const activeRuns = runs.filter((run) => run.status !== "completed");
  const completedRuns = runs.filter((run) => run.status === "completed");

  return {
    repo: data.repo,
    branch: data.branch,
    commit: data.commit,
    pipelineFound: activeRuns.length > 0 || completedRuns.length > 0,
    activeRuns,
    completedRuns,
  };
}
