import { createServerFn } from "@tanstack/react-start";
import { query } from "@/lib/clickhouse";
import type { TimeRange } from "./analytics";
import { timeRangeToDays } from "./analytics";

export interface RunListItem {
  traceId: string;
  runId: string;
  runAttempt: number;
  workflowName: string;
  repo: string;
  branch: string;
  conclusion: string;
  duration: number;
  timestamp: string;
  sender: string;
  jobCount: number;
}

export interface RunsListResult {
  runs: RunListItem[];
  totalCount: number;
}

export interface RunsListInput {
  timeRange: TimeRange;
  page: number;
  pageSize?: number;
  repo?: string;
  branch?: string;
  conclusion?: string;
  workflowName?: string;
  runId?: string;
}

export const getRunsList = createServerFn({
  method: "GET",
})
  .inputValidator((data: RunsListInput) => data)
  .handler(async ({ data }) => {
    const days = timeRangeToDays(data.timeRange);
    const pageSize = data.pageSize || 20;
    const offset = (data.page - 1) * pageSize;

    const conditions: string[] = [
      `Timestamp >= now() - INTERVAL ${days} DAY`,
      "ResourceAttributes['cicd.pipeline.run.id'] != ''",
      "SpanAttributes['citric.github.workflow_job_step.number'] = ''",
    ];
    const params: Record<string, unknown> = {
      pageSize,
      offset,
    };

    if (data.repo) {
      conditions.push(
        "ResourceAttributes['vcs.repository.name'] = {repo:String}",
      );
      params.repo = data.repo;
    }
    if (data.branch) {
      conditions.push(
        "ResourceAttributes['vcs.ref.head.name'] = {branch:String}",
      );
      params.branch = data.branch;
    }
    if (data.conclusion) {
      conditions.push(
        "ResourceAttributes['cicd.pipeline.task.run.result'] = {conclusion:String}",
      );
      params.conclusion = data.conclusion;
    }
    if (data.workflowName) {
      conditions.push(
        "ResourceAttributes['cicd.pipeline.name'] = {workflowName:String}",
      );
      params.workflowName = data.workflowName;
    }
    if (data.runId) {
      conditions.push(
        "ResourceAttributes['cicd.pipeline.run.id'] = {runId:String}",
      );
      params.runId = data.runId;
    }

    const whereClause = conditions.join("\n\t\t\t\tAND ");

    const dataSql = `
			SELECT
				TraceId as trace_id,
				anyLast(ResourceAttributes['cicd.pipeline.run.id']) as run_id,
				anyLast(toUInt32OrZero(ResourceAttributes['citric.github.workflow_job.run_attempt'])) as run_attempt,
				anyLast(ResourceAttributes['cicd.pipeline.name']) as workflowName,
				anyLast(ResourceAttributes['vcs.repository.name']) as repo,
				anyLast(ResourceAttributes['vcs.ref.head.name']) as branch,
				anyLast(ResourceAttributes['cicd.pipeline.task.run.result']) as conclusion,
				max(Duration) / 1000000 as duration,
				max(Timestamp) as timestamp,
				max(ResourceAttributes['cicd.pipeline.task.run.sender.login']) as sender,
				count(*) as jobCount
			FROM otel_traces
			WHERE ${whereClause}
			GROUP BY trace_id
			ORDER BY timestamp DESC
			LIMIT {pageSize:UInt32} OFFSET {offset:UInt32}
		`;

    const countSql = `
			SELECT count(*) as total
			FROM (
				SELECT TraceId as trace_id
				FROM otel_traces
				WHERE ${whereClause}
				GROUP BY trace_id
			)
		`;

    const [dataResult, countResult] = await Promise.all([
      query<{
        trace_id: string;
        run_id: string;
        run_attempt: string;
        workflowName: string;
        repo: string;
        branch: string;
        conclusion: string;
        duration: string;
        timestamp: string;
        sender: string;
        jobCount: string;
      }>(dataSql, params),
      query<{ total: string }>(countSql, params),
    ]);

    return {
      runs: dataResult.map((row) => ({
        traceId: row.trace_id,
        runId: row.run_id,
        runAttempt: Number(row.run_attempt),
        workflowName: row.workflowName || "Workflow",
        repo: row.repo,
        branch: row.branch,
        conclusion: row.conclusion,
        duration: Number(row.duration),
        timestamp: row.timestamp,
        sender: row.sender,
        jobCount: Number(row.jobCount),
      })),
      totalCount: countResult.length > 0 ? Number(countResult[0].total) : 0,
    } satisfies RunsListResult;
  });

export interface FilterOptions {
  repos: string[];
  branches: string[];
  workflowNames: string[];
}

export const getRunFilterOptions = createServerFn({
  method: "GET",
}).handler(async () => {
  const [repos, branches, workflowNames] = await Promise.all([
    query<{ repo: string }>(
      `SELECT DISTINCT ResourceAttributes['vcs.repository.name'] as repo
			FROM otel_traces
			WHERE Timestamp >= now() - INTERVAL 90 DAY
				AND ResourceAttributes['vcs.repository.name'] != ''
			ORDER BY repo
			LIMIT 100`,
    ),
    query<{ branch: string }>(
      `SELECT DISTINCT ResourceAttributes['vcs.ref.head.name'] as branch
			FROM otel_traces
			WHERE Timestamp >= now() - INTERVAL 90 DAY
				AND ResourceAttributes['vcs.ref.head.name'] != ''
			ORDER BY branch
			LIMIT 100`,
    ),
    query<{ workflowName: string }>(
      `SELECT DISTINCT ResourceAttributes['cicd.pipeline.name'] as workflowName
			FROM otel_traces
			WHERE Timestamp >= now() - INTERVAL 90 DAY
				AND ResourceAttributes['cicd.pipeline.name'] != ''
			ORDER BY workflowName
			LIMIT 100`,
    ),
  ]);

  return {
    repos: repos.map((r) => r.repo),
    branches: branches.map((r) => r.branch),
    workflowNames: workflowNames.map((r) => r.workflowName),
  } satisfies FilterOptions;
});
