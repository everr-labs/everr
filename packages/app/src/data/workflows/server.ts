import {
  resolveTimeRange,
  toClickHouseDateTime,
} from "@everr/ui/lib/time-range";
import { calculateCost } from "@/lib/runner-pricing";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import {
  CONCLUSION_EXPR,
  nonEmptyResourceAttribute,
  resourceAttribute,
  resourceAttributeEquals,
  runSummarySubquery,
} from "../run-query-helpers";
import type { RunListItem } from "../runs-list/schemas";
import {
  type WorkflowCostByJob,
  type WorkflowCostSummary,
  WorkflowDetailInputSchema,
  type WorkflowRunGantt,
  type WorkflowRunListItem,
} from "./schemas";

const AND = "\n\t\t\t\tAND ";

// This workflow's runs (the pipeline-run span level).
const RUN_FILTER = [
  nonEmptyResourceAttribute("cicd.pipeline.run.id"),
  resourceAttributeEquals("cicd.pipeline.name", "workflowName"),
  resourceAttributeEquals("vcs.repository.name", "repo"),
].join(AND);

// Job-level rows only: exclude step and test spans, drop skipped jobs, and
// require a runner-labels attribute so pricing can be resolved.
const JOB_COST_FILTER = [
  resourceAttributeEquals("cicd.pipeline.name", "workflowName"),
  resourceAttributeEquals("vcs.repository.name", "repo"),
  nonEmptyResourceAttribute("cicd.pipeline.worker.labels"),
  nonEmptyResourceAttribute("cicd.pipeline.task.run.id"),
  `lowerUTF8(${resourceAttribute("cicd.pipeline.task.run.result")}) != 'skip'`,
  "SpanAttributes['everr.github.workflow_job_step.number'] = ''",
].join(AND);

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
      // Job-level cost & billed minutes by runner labels, current vs previous.
      clickhouse.query<{
        labels: string;
        currentDurationMs: string;
        currentRoundedMinutes: string;
        prevDurationMs: string;
        prevRoundedMinutes: string;
      }>(
        `
				SELECT
					ResourceAttributes['cicd.pipeline.worker.labels'] as labels,
					sumIf(Duration, Timestamp >= {fromTime:String}) / 1000000 as currentDurationMs,
					sumIf(ceil(Duration / 60000000000.0), Timestamp >= {fromTime:String}) as currentRoundedMinutes,
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
        runsCurrent: string;
        avgWallCurrent: string;
        avgWallPrev: string;
      }>(
        `
				SELECT
					countIf(ts >= {fromTime:String}) as runsCurrent,
					avgIf(wall, ts >= {fromTime:String}) as avgWallCurrent,
					avgIf(wall, ts < {fromTime:String}) as avgWallPrev
				FROM (
					SELECT
						max(Duration) / 1000000 as wall,
						max(Timestamp) as ts
					FROM traces
					WHERE Timestamp >= {prevFromTime:String} AND Timestamp <= {toTime:String}
						AND ${RUN_FILTER}
					GROUP BY ResourceAttributes['cicd.pipeline.run.id']
				)
			`,
        params,
      ),
      // Daily cost for the spend sparkline (current period).
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
    for (const row of costRows) {
      totalCost += calculateCost(
        row.labels,
        Number(row.currentDurationMs),
        Number(row.currentRoundedMinutes),
      ).estimatedCost;
      billedMinutes += Number(row.currentRoundedMinutes);
      prevTotalCost += calculateCost(
        row.labels,
        Number(row.prevDurationMs),
        Number(row.prevRoundedMinutes),
      ).estimatedCost;
    }

    const run = runRows[0];
    const totalRuns = run ? Number(run.runsCurrent) : 0;

    // Sum spend per day, then fill gaps so the sparkline has one point per day.
    const dailySpend = new Map<string, number>();
    for (const row of dailyRows) {
      const spend = calculateCost(
        row.labels,
        Number(row.durationMs),
        Number(row.roundedMinutes),
      ).estimatedCost;
      dailySpend.set(row.date, (dailySpend.get(row.date) ?? 0) + spend);
    }

    const overTime: number[] = [];
    for (
      const d = new Date(fromDate);
      d <= toDate;
      d.setDate(d.getDate() + 1)
    ) {
      overTime.push(dailySpend.get(d.toISOString().slice(0, 10)) ?? 0);
    }

    return {
      totalCost,
      prevTotalCost,
      avgCostPerRun: totalRuns > 0 ? totalCost / totalRuns : 0,
      totalRuns,
      billedMinutes,
      avgWallClockMs: run ? Number(run.avgWallCurrent) : 0,
      prevAvgWallClockMs: run ? Number(run.avgWallPrev) : 0,
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
				AND ${nonEmptyResourceAttribute("cicd.pipeline.task.name")}
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
				AND ${RUN_FILTER}
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
				AND ${nonEmptyResourceAttribute("cicd.pipeline.task.run.id")}
				AND SpanAttributes['everr.github.workflow_job_step.number'] = ''
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
      let startMs = Number.POSITIVE_INFINITY;
      let endMs = Number.NEGATIVE_INFINITY;
      let estimatedCost = 0;
      for (const j of jobs) {
        if (j.startMs < startMs) startMs = j.startMs;
        if (j.endMs > endMs) endMs = j.endMs;
        estimatedCost += j.estimatedCost;
      }
      timelines.push({
        runId: runMeta.run_id,
        traceId: runMeta.trace_id,
        runAttempt: Number(runMeta.run_attempt),
        conclusion: runMeta.conclusion || "unknown",
        timestamp: runMeta.timestamp,
        startMs,
        wallClockMs: endMs - startMs,
        estimatedCost,
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
					AND ${RUN_FILTER}
					AND ${nonEmptyResourceAttribute("cicd.pipeline.task.run.result")}
					AND SpanAttributes['everr.github.workflow_job_step.number'] = ''`,
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
