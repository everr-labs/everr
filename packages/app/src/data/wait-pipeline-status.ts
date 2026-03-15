import { z } from "zod";

export interface WaitPipelineRun {
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

export interface WaitPipelineJob {
  jobId: string;
  jobName: string;
  phase: string;
  conclusion: string;
  lastEventTime: string;
  durationSeconds: number;
  pipelineRunId: string;
}

export interface WaitPipelineStatusResult {
  repo: string;
  branch: string;
  commit: string;
  activeRuns: WaitPipelineRun[];
  completedRuns: WaitPipelineRun[];
}

export const WaitPipelineStatusInputSchema = z.object({
  repo: z.string().min(1),
  branch: z.string().min(1),
  commit: z.string().min(1),
});

export interface WaitPipelineRow {
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

export interface WaitPipelineDurationBaseline {
  durationSeconds: number;
  sampleSize: number;
}

export function buildWaitPipelineStatus(
  data: z.infer<typeof WaitPipelineStatusInputSchema>,
  rows: WaitPipelineRow[],
  durationBaselinesByWorkflow = new Map<string, WaitPipelineDurationBaseline>(),
): WaitPipelineStatusResult {
  const jobs: WaitPipelineJob[] = rows
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

  const runs: WaitPipelineRun[] = rows
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

  return {
    repo: data.repo,
    branch: data.branch,
    commit: data.commit,
    activeRuns: runs.filter((run) => run.phase !== "finished"),
    completedRuns: runs.filter((run) => run.phase === "finished"),
  };
}
