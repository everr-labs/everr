import {
  resolveTimeRange,
  toClickHouseDateTime,
} from "@everr/ui/lib/time-range";
import { calculateCost, getRunnerPricing } from "@/lib/runner-pricing";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { CONCLUSION_EXPR, runSummarySubquery } from "../run-query-helpers";
import type { RunListItem } from "../runs-list/schemas";
import {
  type WorkflowCostByJob,
  type WorkflowCostOverTimePoint,
  type WorkflowCostSummary,
  WorkflowDetailInputSchema,
  type WorkflowRunGantt,
  type WorkflowRunListItem,
} from "./schemas";

// Job-level rows only: exclude step and test spans, drop skipped jobs, and
// require a runner-labels attribute so pricing can be resolved.
const JOB_COST_FILTER = `
	ResourceAttributes['cicd.pipeline.name'] = {workflowName:String}
	AND ResourceAttributes['vcs.repository.name'] = {repo:String}
	AND ResourceAttributes['cicd.pipeline.worker.labels'] != ''
	AND ResourceAttributes['cicd.pipeline.task.run.id'] != ''
	AND lowerUTF8(ResourceAttributes['cicd.pipeline.task.run.result']) != 'skip'
	AND SpanAttributes['everr.github.workflow_job_step.number'] = ''
	AND SpanAttributes['everr.test.name'] = ''`;

const MS_PER_MINUTE = 60_000;

export const getWorkflowCostSummary = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(WorkflowDetailInputSchema)
  .handler(async ({ data, context: { clickhouse } }) => {
    const { fromDate, toDate, fromISO, toISO } = resolveTimeRange(
      data.timeRange,
    );
    const periodMs = toDate.getTime() - fromDate.getTime();
    const prevFromISO = toClickHouseDateTime(
      new Date(fromDate.getTime() - periodMs),
    );

    const params = {
      fromTime: fromISO,
      toTime: toISO,
      prevFromTime: prevFromISO,
      workflowName: data.workflowName,
      repo: data.repo,
    };

    const [costRows, runRows, dailyRows] = await Promise.all([
      // Job-level cost & minutes by runner labels, current vs previous period.
      clickhouse.query<{
        labels: string;
        currentDurationMs: string;
        currentRoundedMinutes: string;
        currentJobCount: string;
        prevDurationMs: string;
        prevRoundedMinutes: string;
      }>(
        `
				SELECT
					ResourceAttributes['cicd.pipeline.worker.labels'] as labels,
					sumIf(Duration, Timestamp >= {fromTime:String}) / 1000000 as currentDurationMs,
					sumIf(ceil(Duration / 60000000000.0), Timestamp >= {fromTime:String}) as currentRoundedMinutes,
					countIf(Timestamp >= {fromTime:String}) as currentJobCount,
					sumIf(Duration, Timestamp < {fromTime:String}) / 1000000 as prevDurationMs,
					sumIf(ceil(Duration / 60000000000.0), Timestamp < {fromTime:String}) as prevRoundedMinutes
				FROM traces
				WHERE Timestamp >= {prevFromTime:String} AND Timestamp <= {toTime:String}
					AND ${JOB_COST_FILTER}
				GROUP BY labels
			`,
        params,
      ),
      // Run-level wall-clock: the pipeline-run span is the longest span per run,
      // so max(Duration) per run is its real elapsed time.
      clickhouse.query<{
        wallMsCurrent: string;
        runsCurrent: string;
        avgWallCurrent: string;
        runsPrev: string;
        avgWallPrev: string;
      }>(
        `
				SELECT
					sumIf(wall, ts >= {fromTime:String}) as wallMsCurrent,
					countIf(ts >= {fromTime:String}) as runsCurrent,
					avgIf(wall, ts >= {fromTime:String}) as avgWallCurrent,
					countIf(ts < {fromTime:String}) as runsPrev,
					avgIf(wall, ts < {fromTime:String}) as avgWallPrev
				FROM (
					SELECT
						ResourceAttributes['cicd.pipeline.run.id'] as run_id,
						max(Duration) / 1000000 as wall,
						max(Timestamp) as ts
					FROM traces
					WHERE Timestamp >= {prevFromTime:String} AND Timestamp <= {toTime:String}
						AND ResourceAttributes['cicd.pipeline.run.id'] != ''
						AND ResourceAttributes['cicd.pipeline.name'] = {workflowName:String}
						AND ResourceAttributes['vcs.repository.name'] = {repo:String}
					GROUP BY run_id
				)
			`,
        params,
      ),
      // Daily cost & compute minutes for the over-time chart (current period).
      clickhouse.query<{
        date: string;
        labels: string;
        durationMs: string;
        roundedMinutes: string;
      }>(
        `
				SELECT
					toDate(Timestamp) as date,
					ResourceAttributes['cicd.pipeline.worker.labels'] as labels,
					sum(Duration) / 1000000 as durationMs,
					sum(ceil(Duration / 60000000000.0)) as roundedMinutes
				FROM traces
				WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
					AND ${JOB_COST_FILTER}
				GROUP BY date, labels
				ORDER BY date ASC
			`,
        params,
      ),
    ]);

    let totalCost = 0;
    let prevTotalCost = 0;
    let billedMinutes = 0;
    let computeMinutes = 0;
    let selfHostedMinutes = 0;
    let jobExecutions = 0;

    for (const row of costRows) {
      const current = calculateCost(
        row.labels,
        Number(row.currentDurationMs),
        Number(row.currentRoundedMinutes),
      );
      totalCost += current.estimatedCost;
      billedMinutes += Number(row.currentRoundedMinutes);
      computeMinutes += current.actualMinutes;
      jobExecutions += Number(row.currentJobCount);
      if (getRunnerPricing(row.labels).isSelfHosted) {
        selfHostedMinutes += current.actualMinutes;
      }
      prevTotalCost += calculateCost(
        row.labels,
        Number(row.prevDurationMs),
        Number(row.prevRoundedMinutes),
      ).estimatedCost;
    }

    const run = runRows[0];
    const totalRuns = run ? Number(run.runsCurrent) : 0;
    const wallClockMinutes = run
      ? Number(run.wallMsCurrent) / MS_PER_MINUTE
      : 0;

    // Daily aggregation, then fill gaps so the chart has one point per day.
    const dailyMap = new Map<string, { spend: number; minutes: number }>();
    for (const row of dailyRows) {
      const entry = dailyMap.get(row.date) ?? { spend: 0, minutes: 0 };
      entry.spend += calculateCost(
        row.labels,
        Number(row.durationMs),
        Number(row.roundedMinutes),
      ).estimatedCost;
      entry.minutes += Number(row.durationMs) / MS_PER_MINUTE;
      dailyMap.set(row.date, entry);
    }

    const overTime: WorkflowCostOverTimePoint[] = [];
    for (
      const d = new Date(fromDate);
      d <= toDate;
      d.setDate(d.getDate() + 1)
    ) {
      const date = d.toISOString().slice(0, 10);
      const entry = dailyMap.get(date);
      overTime.push({
        date,
        spend: entry?.spend ?? 0,
        minutes: entry?.minutes ?? 0,
      });
    }

    return {
      totalCost,
      prevTotalCost,
      avgCostPerRun: totalRuns > 0 ? totalCost / totalRuns : 0,
      totalRuns,
      prevTotalRuns: run ? Number(run.runsPrev) : 0,
      billedMinutes,
      computeMinutes,
      wallClockMinutes,
      avgWallClockMs: run ? Number(run.avgWallCurrent) : 0,
      prevAvgWallClockMs: run ? Number(run.avgWallPrev) : 0,
      avgJobsPerRun: totalRuns > 0 ? jobExecutions / totalRuns : 0,
      selfHostedMinutes,
      overTime,
    } satisfies WorkflowCostSummary;
  });

export const getWorkflowCostByJob = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(WorkflowDetailInputSchema)
  .handler(async ({ data, context: { clickhouse } }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);

    const rows = await clickhouse.query<{
      job: string;
      labels: string;
      runs: string;
      durationMs: string;
      roundedMinutes: string;
    }>(
      `
			SELECT
				ResourceAttributes['cicd.pipeline.task.name'] as job,
				ResourceAttributes['cicd.pipeline.worker.labels'] as labels,
				uniqExact(ResourceAttributes['cicd.pipeline.run.id']) as runs,
				sum(Duration) / 1000000 as durationMs,
				sum(ceil(Duration / 60000000000.0)) as roundedMinutes
			FROM traces
			WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
				AND ${JOB_COST_FILTER}
				AND ResourceAttributes['cicd.pipeline.task.name'] != ''
			GROUP BY job, labels
		`,
      {
        fromTime: fromISO,
        toTime: toISO,
        workflowName: data.workflowName,
        repo: data.repo,
      },
    );

    // A job almost always runs on one runner type, but if it switched runners
    // mid-range it appears under multiple label groups; merge them per job.
    const byJob = new Map<string, WorkflowCostByJob>();
    for (const row of rows) {
      const cost = calculateCost(
        row.labels,
        Number(row.durationMs),
        Number(row.roundedMinutes),
      );
      const entry = byJob.get(row.job) ?? {
        job: row.job,
        runs: 0,
        computeMinutes: 0,
        billedMinutes: 0,
        estimatedCost: 0,
      };
      entry.runs = Math.max(entry.runs, Number(row.runs));
      entry.computeMinutes += cost.actualMinutes;
      entry.billedMinutes += Number(row.roundedMinutes);
      entry.estimatedCost += cost.estimatedCost;
      byJob.set(row.job, entry);
    }

    return [...byJob.values()].sort(
      (a, b) =>
        b.estimatedCost - a.estimatedCost ||
        b.computeMinutes - a.computeMinutes,
    ) satisfies WorkflowCostByJob[];
  });

// How many recent completed runs the Gantt lets you page through.
const GANTT_RUN_LIMIT = 12;

export const getWorkflowRunTimelines = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(WorkflowDetailInputSchema)
  .handler(async ({ data, context: { clickhouse } }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);

    // The most recent runs that actually recorded timing (skip queued / in
    // progress), newest first.
    const runRows = await clickhouse.query<{
      trace_id: string;
      run_id: string;
      run_attempt: string;
      conclusion: string;
      timestamp: string;
    }>(
      `
			SELECT
				TraceId as trace_id,
				anyLast(ResourceAttributes['cicd.pipeline.run.id']) as run_id,
				anyLast(toUInt32OrZero(ResourceAttributes['everr.github.workflow_job.run_attempt'])) as run_attempt,
				${CONCLUSION_EXPR} as conclusion,
				max(Timestamp) as timestamp
			FROM traces
			WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
				AND ResourceAttributes['cicd.pipeline.run.id'] != ''
				AND ResourceAttributes['cicd.pipeline.name'] = {workflowName:String}
				AND ResourceAttributes['vcs.repository.name'] = {repo:String}
			GROUP BY TraceId
			HAVING max(Duration) > 0
			ORDER BY timestamp DESC
			LIMIT {limit:UInt32}
		`,
      {
        fromTime: fromISO,
        toTime: toISO,
        workflowName: data.workflowName,
        repo: data.repo,
        limit: GANTT_RUN_LIMIT,
      },
    );

    if (runRows.length === 0) return [] satisfies WorkflowRunGantt[];

    // Fetch the jobs for every selected run in one pass.
    const jobRows = await clickhouse.query<{
      trace_id: string;
      jobId: string;
      name: string;
      conclusion: string;
      labels: string;
      startMs: string;
      endMs: string;
      durationMs: string;
    }>(
      `
			SELECT
				TraceId as trace_id,
				ResourceAttributes['cicd.pipeline.task.run.id'] as jobId,
				anyLast(ResourceAttributes['cicd.pipeline.task.name']) as name,
				anyLast(ResourceAttributes['cicd.pipeline.task.run.result']) as conclusion,
				anyLast(ResourceAttributes['cicd.pipeline.worker.labels']) as labels,
				min(toUnixTimestamp64Milli(Timestamp)) as startMs,
				max(toUnixTimestamp64Milli(Timestamp) + intDiv(Duration, 1000000)) as endMs,
				max(Duration) / 1000000 as durationMs
			FROM traces
			WHERE TraceId IN {traceIds:Array(String)}
				AND ResourceAttributes['cicd.pipeline.task.run.id'] != ''
				AND SpanAttributes['everr.github.workflow_job_step.number'] = ''
				AND SpanAttributes['everr.test.name'] = ''
			GROUP BY trace_id, jobId
			ORDER BY startMs ASC
		`,
      { traceIds: runRows.map((r) => r.trace_id) },
    );

    const jobsByTrace = new Map<string, WorkflowRunGantt["jobs"]>();
    for (const row of jobRows) {
      const durationMs = Number(row.durationMs);
      const list = jobsByTrace.get(row.trace_id) ?? [];
      list.push({
        jobId: row.jobId,
        name: row.name || "job",
        conclusion: row.conclusion || "unknown",
        startMs: Number(row.startMs),
        endMs: Number(row.endMs),
        durationMs,
        estimatedCost: calculateCost(row.labels, durationMs).estimatedCost,
      });
      jobsByTrace.set(row.trace_id, list);
    }

    const timelines: WorkflowRunGantt[] = [];
    for (const runMeta of runRows) {
      const jobs = jobsByTrace.get(runMeta.trace_id);
      if (!jobs || jobs.length === 0) continue;
      const startMs = Math.min(...jobs.map((j) => j.startMs));
      const endMs = Math.max(...jobs.map((j) => j.endMs));
      timelines.push({
        runId: runMeta.run_id,
        traceId: runMeta.trace_id,
        runAttempt: Number(runMeta.run_attempt),
        conclusion: runMeta.conclusion || "unknown",
        timestamp: runMeta.timestamp,
        startMs,
        endMs,
        wallClockMs: endMs - startMs,
        computeMs: jobs.reduce((sum, j) => sum + j.durationMs, 0),
        estimatedCost: jobs.reduce((sum, j) => sum + j.estimatedCost, 0),
        jobs,
      });
    }

    return timelines satisfies WorkflowRunGantt[];
  });

export const getWorkflowRecentRuns = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(WorkflowDetailInputSchema)
  .handler(async ({ data, context: { clickhouse } }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);
    const queryParams = {
      fromTime: fromISO,
      toTime: toISO,
      workflowName: data.workflowName,
      repo: data.repo,
    };

    const runSummarySql = runSummarySubquery({
      whereClause: `Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
					AND ResourceAttributes['cicd.pipeline.run.id'] != ''
					AND ResourceAttributes['cicd.pipeline.name'] = {workflowName:String}
					AND ResourceAttributes['vcs.repository.name'] = {repo:String}
					AND ResourceAttributes['cicd.pipeline.task.run.result'] != ''
					AND SpanAttributes['everr.github.workflow_job_step.number'] = ''
					AND SpanAttributes['everr.test.name'] = ''`,
      groupByExpr: "TraceId",
      groupByAlias: "trace_id",
      includeRunAttempt: true,
      includeDuration: true,
      includeSender: true,
      includeJobCount: true,
    });

    const [runRows, costRows] = await Promise.all([
      clickhouse.query<{
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
      }>(
        `SELECT * FROM (${runSummarySql}) ORDER BY timestamp DESC LIMIT 10`,
        queryParams,
      ),
      // Per-run estimated cost, keyed by run id and aggregated across labels.
      clickhouse.query<{
        run_id: string;
        labels: string;
        durationMs: string;
        roundedMinutes: string;
      }>(
        `
				SELECT
					ResourceAttributes['cicd.pipeline.run.id'] as run_id,
					ResourceAttributes['cicd.pipeline.worker.labels'] as labels,
					sum(Duration) / 1000000 as durationMs,
					sum(ceil(Duration / 60000000000.0)) as roundedMinutes
				FROM traces
				WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
					AND ${JOB_COST_FILTER}
				GROUP BY run_id, labels
			`,
        queryParams,
      ),
    ]);

    const costByRunId = new Map<string, number>();
    for (const row of costRows) {
      const cost = calculateCost(
        row.labels,
        Number(row.durationMs),
        Number(row.roundedMinutes),
      ).estimatedCost;
      costByRunId.set(row.run_id, (costByRunId.get(row.run_id) ?? 0) + cost);
    }

    return runRows.map((row) => {
      const base: RunListItem = {
        traceId: row.trace_id,
        runId: row.run_id,
        runAttempt: Number(row.run_attempt),
        workflowName: row.workflowName || "Workflow",
        repo: row.repo,
        branch: row.branch,
        conclusion: row.conclusion,
        duration: Number(row.duration),
        runningSince: null,
        timestamp: row.timestamp,
        sender: row.sender,
        jobCount: Number(row.jobCount),
      };
      return {
        ...base,
        estimatedCost: costByRunId.get(row.run_id) ?? 0,
      };
    }) satisfies WorkflowRunListItem[];
  });
