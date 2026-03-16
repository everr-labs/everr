import { z } from "zod";

export interface WatchRun {
  runId: string;
  workflowName: string;
  phase: string;
  conclusion: string;
  lastEventTime: string;
  durationSeconds: number;
  usualDurationSeconds: number | null;
  usualDurationSampleSize: number;
  activeJobs: string[];
}

export interface WatchJob {
  jobId: string;
  jobName: string;
  phase: string;
  conclusion: string;
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
  subjectName: string;
  htmlUrl: string;
  phase: string;
  conclusion: string;
  lastEventTime: string;
  eventKind: string;
  pipelineRunId: string;
  durationSeconds: string;
}

export interface WatchDurationBaseline {
  durationSeconds: number;
  sampleSize: number;
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
      phase: row.phase,
      conclusion: row.conclusion,
      lastEventTime: row.lastEventTime,
      durationSeconds: Number(row.durationSeconds),
      pipelineRunId: row.pipelineRunId,
    }));

  const activeJobsByRunId = new Map<string, string[]>();
  for (const job of jobs) {
    if (job.phase === "finished") {
      continue;
    }

    const activeJobs = activeJobsByRunId.get(job.pipelineRunId);
    if (activeJobs) {
      activeJobs.push(job.jobName);
    } else {
      activeJobsByRunId.set(job.pipelineRunId, [job.jobName]);
    }
  }

  const runs: WatchRun[] = rows
    .filter((row) => row.eventKind === "pipelinerun")
    .map((row) => {
      const baseline = durationBaselinesByWorkflow.get(row.subjectName);

      return {
        runId: row.subjectId,
        workflowName: row.subjectName,
        phase: row.phase,
        conclusion: row.conclusion,
        lastEventTime: row.lastEventTime,
        durationSeconds: Number(row.durationSeconds),
        usualDurationSeconds: baseline?.durationSeconds ?? null,
        usualDurationSampleSize: baseline?.sampleSize ?? 0,
        activeJobs: activeJobsByRunId.get(row.subjectId) ?? [],
      };
    });

  const activeRuns = runs.filter((run) => run.phase !== "finished");
  const completedRuns = runs.filter((run) => run.phase === "finished");

  return {
    repo: data.repo,
    branch: data.branch,
    commit: data.commit,
    pipelineFound: activeRuns.length > 0 || completedRuns.length > 0,
    activeRuns,
    completedRuns,
  };
}
