import {
  resolveTimeRange,
  toClickHouseDateTime,
} from "@everr/ui/lib/time-range";
import { calculateCost } from "@/lib/runner-pricing";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { runSummarySubquery } from "../run-query-helpers";
import type { RunListItem } from "../runs-list/schemas";
import {
  type WorkflowCost,
  WorkflowDetailInputSchema,
  type WorkflowDurationTrendPoint,
  type WorkflowStats,
  type WorkflowTrendPoint,
} from "./schemas";

export const getWorkflowStats = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(WorkflowDetailInputSchema)
  .handler(async ({ data, context: { clickhouse } }) => {
    const { fromDate, toDate, fromISO, toISO } = resolveTimeRange(
      data.timeRange,
    );

    const periodMs = toDate.getTime() - fromDate.getTime();
    const prevFromDate = new Date(fromDate.getTime() - periodMs);
    const prevFromISO = toClickHouseDateTime(prevFromDate);

    const sql = `
			SELECT
				countIf(timestamp >= {fromTime:String}) as totalRuns,
				round(countIf(conclusion = 'success' AND timestamp >= {fromTime:String}) * 100.0
					/ nullIf(countIf(timestamp >= {fromTime:String}), 0), 1) as successRate,
				avgIf(duration, timestamp >= {fromTime:String}) as avgDuration,
				quantileIf(0.95)(duration, timestamp >= {fromTime:String}) as p95Duration,
				countIf(timestamp < {fromTime:String}) as prevTotalRuns,
				round(countIf(conclusion = 'success' AND timestamp < {fromTime:String}) * 100.0
					/ nullIf(countIf(timestamp < {fromTime:String}), 0), 1) as prevSuccessRate,
				avgIf(duration, timestamp < {fromTime:String}) as prevAvgDuration
			FROM (
				SELECT
					ResourceAttributes['cicd.pipeline.run.id'] as run_id,
					anyLast(ResourceAttributes['cicd.pipeline.task.run.result']) as conclusion,
					max(Duration) / 1000000 as duration,
					max(Timestamp) as timestamp
				FROM traces
				WHERE Timestamp >= {prevFromTime:String} AND Timestamp <= {toTime:String}
					AND ResourceAttributes['cicd.pipeline.run.id'] != ''
					AND ResourceAttributes['cicd.pipeline.name'] = {workflowName:String}
					AND ResourceAttributes['vcs.repository.name'] = {repo:String}
					AND ResourceAttributes['cicd.pipeline.task.run.result'] != ''
				GROUP BY run_id
			)
		`;

    const result = await clickhouse.query<{
      totalRuns: string;
      successRate: string;
      avgDuration: string;
      p95Duration: string;
      prevTotalRuns: string;
      prevSuccessRate: string;
      prevAvgDuration: string;
    }>(sql, {
      fromTime: fromISO,
      toTime: toISO,
      prevFromTime: prevFromISO,
      workflowName: data.workflowName,
      repo: data.repo,
    });

    if (result.length === 0) {
      return {
        totalRuns: 0,
        successRate: 0,
        avgDuration: 0,
        p95Duration: 0,
        prevTotalRuns: 0,
        prevSuccessRate: 0,
        prevAvgDuration: 0,
      } satisfies WorkflowStats;
    }

    const row = result[0];
    return {
      totalRuns: Number(row.totalRuns),
      successRate: Number(row.successRate) || 0,
      avgDuration: Number(row.avgDuration),
      p95Duration: Number(row.p95Duration),
      prevTotalRuns: Number(row.prevTotalRuns),
      prevSuccessRate: Number(row.prevSuccessRate) || 0,
      prevAvgDuration: Number(row.prevAvgDuration),
    } satisfies WorkflowStats;
  });

export const getWorkflowSuccessRateTrend = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(WorkflowDetailInputSchema)
  .handler(async ({ data, context: { clickhouse } }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);

    const sql = `
			SELECT
				date,
				count(*) as totalRuns,
				round(countIf(conclusion = 'success') * 100.0 / nullIf(count(*), 0), 1) as successRate,
				countIf(conclusion = 'success') as successCount,
				countIf(conclusion = 'failure') as failureCount
			FROM (
				SELECT
					toDate(max(Timestamp)) as date,
					ResourceAttributes['cicd.pipeline.run.id'] as run_id,
					anyLast(ResourceAttributes['cicd.pipeline.task.run.result']) as conclusion
				FROM traces
				WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
					AND ResourceAttributes['cicd.pipeline.run.id'] != ''
					AND ResourceAttributes['cicd.pipeline.name'] = {workflowName:String}
					AND ResourceAttributes['vcs.repository.name'] = {repo:String}
					AND ResourceAttributes['cicd.pipeline.task.run.result'] != ''
				GROUP BY run_id
			)
			GROUP BY date
			ORDER BY date ASC WITH FILL FROM toDate({fromTime:String}) TO toDate({toTime:String}) + 1
		`;

    const result = await clickhouse.query<{
      date: string;
      totalRuns: string;
      successRate: string;
      successCount: string;
      failureCount: string;
    }>(sql, {
      fromTime: fromISO,
      toTime: toISO,
      workflowName: data.workflowName,
      repo: data.repo,
    });

    return result.map((row) => ({
      date: row.date,
      totalRuns: Number(row.totalRuns),
      successRate: Number(row.successRate) || 0,
      successCount: Number(row.successCount),
      failureCount: Number(row.failureCount),
    })) satisfies WorkflowTrendPoint[];
  });

export const getWorkflowDurationTrend = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(WorkflowDetailInputSchema)
  .handler(async ({ data, context: { clickhouse } }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);

    const sql = `
			SELECT
				toDate(timestamp) as date,
				avg(duration) as avgDuration,
				quantile(0.95)(duration) as p95Duration
			FROM (
				SELECT
					ResourceAttributes['cicd.pipeline.run.id'] as run_id,
					max(Duration) / 1000000 as duration,
					max(Timestamp) as timestamp
				FROM traces
				WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
					AND ResourceAttributes['cicd.pipeline.run.id'] != ''
					AND ResourceAttributes['cicd.pipeline.name'] = {workflowName:String}
					AND ResourceAttributes['vcs.repository.name'] = {repo:String}
				GROUP BY run_id
			)
			GROUP BY date
			ORDER BY date ASC WITH FILL FROM toDate({fromTime:String}) TO toDate({toTime:String}) + 1
		`;

    const result = await clickhouse.query<{
      date: string;
      avgDuration: string;
      p95Duration: string;
    }>(sql, {
      fromTime: fromISO,
      toTime: toISO,
      workflowName: data.workflowName,
      repo: data.repo,
    });

    return result.map((row) => ({
      date: row.date,
      avgDuration: Number(row.avgDuration),
      p95Duration: Number(row.p95Duration),
    })) satisfies WorkflowDurationTrendPoint[];
  });

export const getWorkflowCost = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(WorkflowDetailInputSchema)
  .handler(async ({ data, context: { clickhouse } }) => {
    const { fromDate, toDate, fromISO, toISO } = resolveTimeRange(
      data.timeRange,
    );
    const periodMs = toDate.getTime() - fromDate.getTime();
    const prevFromDate = new Date(fromDate.getTime() - periodMs);
    const prevFromISO = toClickHouseDateTime(prevFromDate);

    const [summaryRows, dailyRows] = await Promise.all([
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
					AND ResourceAttributes['cicd.pipeline.name'] = {workflowName:String}
					AND ResourceAttributes['vcs.repository.name'] = {repo:String}
					AND ResourceAttributes['cicd.pipeline.worker.labels'] != ''
					AND ResourceAttributes['cicd.pipeline.task.run.id'] != ''
					AND lowerUTF8(ResourceAttributes['cicd.pipeline.task.run.result']) != 'skip'
					AND SpanAttributes['everr.github.workflow_job_step.number'] = ''
					AND SpanAttributes['everr.test.name'] = ''
				GROUP BY labels
			`,
        {
          fromTime: fromISO,
          toTime: toISO,
          prevFromTime: prevFromISO,
          workflowName: data.workflowName,
          repo: data.repo,
        },
      ),
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
					AND ResourceAttributes['cicd.pipeline.name'] = {workflowName:String}
					AND ResourceAttributes['vcs.repository.name'] = {repo:String}
					AND ResourceAttributes['cicd.pipeline.worker.labels'] != ''
					AND ResourceAttributes['cicd.pipeline.task.run.id'] != ''
					AND lowerUTF8(ResourceAttributes['cicd.pipeline.task.run.result']) != 'skip'
					AND SpanAttributes['everr.github.workflow_job_step.number'] = ''
					AND SpanAttributes['everr.test.name'] = ''
				GROUP BY date, labels
				ORDER BY date ASC
			`,
        {
          fromTime: fromISO,
          toTime: toISO,
          workflowName: data.workflowName,
          repo: data.repo,
        },
      ),
    ]);

    let totalCost = 0;
    let totalMinutes = 0;
    let prevTotalCost = 0;

    for (const row of summaryRows) {
      const currentResult = calculateCost(
        row.labels,
        Number(row.currentDurationMs),
        Number(row.currentRoundedMinutes),
      );
      totalCost += currentResult.estimatedCost;
      totalMinutes += currentResult.actualMinutes;

      const prevResult = calculateCost(
        row.labels,
        Number(row.prevDurationMs),
        Number(row.prevRoundedMinutes),
      );
      prevTotalCost += prevResult.estimatedCost;
    }

    // Build daily cost sparkline
    const dailyCostMap = new Map<string, number>();
    for (const row of dailyRows) {
      const cost = calculateCost(
        row.labels,
        Number(row.durationMs),
        Number(row.roundedMinutes),
      ).estimatedCost;
      dailyCostMap.set(row.date, (dailyCostMap.get(row.date) ?? 0) + cost);
    }

    // Fill missing dates
    const overTime: number[] = [];
    for (
      const d = new Date(fromDate);
      d <= toDate;
      d.setDate(d.getDate() + 1)
    ) {
      const dateStr = d.toISOString().slice(0, 10);
      overTime.push(dailyCostMap.get(dateStr) ?? 0);
    }

    return {
      totalCost,
      totalMinutes,
      prevTotalCost,
      overTime,
    } satisfies WorkflowCost;
  });

export const getWorkflowRecentRuns = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(WorkflowDetailInputSchema)
  .handler(async ({ data, context: { clickhouse } }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);
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

    const sql = `
      SELECT *
      FROM (${runSummarySql})
			ORDER BY timestamp DESC
			LIMIT 10
		`;

    const result = await clickhouse.query<{
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
    }>(sql, {
      fromTime: fromISO,
      toTime: toISO,
      workflowName: data.workflowName,
      repo: data.repo,
    });

    return result.map((row) => ({
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
    })) satisfies RunListItem[];
  });
