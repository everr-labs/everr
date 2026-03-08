import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query } from "@/lib/clickhouse";
import { calculateCost } from "@/lib/runner-pricing";
import { resolveTimeRange, TimeRangeSchema } from "@/lib/time-range";
import { runSummarySubquery } from "./run-query-helpers";
import type { RunListItem } from "./runs-list";

// ── Types ───────────────────────────────────────────────────────────────

export interface WorkflowListItem {
  workflowName: string;
  repo: string;
  totalRuns: number;
  successRate: number;
  avgDuration: number;
  lastRunAt: string;
  prevTotalRuns: number;
  prevSuccessRate: number;
  prevAvgDuration: number;
}

export interface WorkflowsListResult {
  workflows: WorkflowListItem[];
  totalCount: number;
}

export interface WorkflowSparklineBucket {
  date: string;
  totalRuns: number;
  successRate: number;
  avgDuration: number;
}

export interface WorkflowSparklineData {
  workflowName: string;
  repo: string;
  buckets: WorkflowSparklineBucket[];
}

export interface WorkflowStats {
  totalRuns: number;
  successRate: number;
  avgDuration: number;
  p95Duration: number;
  prevTotalRuns: number;
  prevSuccessRate: number;
  prevAvgDuration: number;
}

export interface WorkflowTrendPoint {
  date: string;
  totalRuns: number;
  successRate: number;
  successCount: number;
  failureCount: number;
}

export interface WorkflowDurationTrendPoint {
  date: string;
  avgDuration: number;
  p95Duration: number;
}

export interface WorkflowFailingJob {
  jobName: string;
  failureCount: number;
  totalRuns: number;
  successRate: number;
}

export interface WorkflowFailureReason {
  pattern: string;
  count: number;
  lastOccurrence: string;
}

// ── Input Schemas ───────────────────────────────────────────────────────

const WorkflowsListInputSchema = z.object({
  timeRange: TimeRangeSchema,
  page: z.coerce.number().int().min(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  repo: z.string().optional(),
  search: z.string().optional(),
});
export type WorkflowsListInput = z.infer<typeof WorkflowsListInputSchema>;

const WorkflowsSparklineInputSchema = z.object({
  timeRange: TimeRangeSchema,
  workflows: z.array(z.object({ workflowName: z.string(), repo: z.string() })),
});
type WorkflowsSparklineInput = z.infer<typeof WorkflowsSparklineInputSchema>;

const WorkflowDetailInputSchema = z.object({
  timeRange: TimeRangeSchema,
  workflowName: z.string(),
  repo: z.string(),
});
type WorkflowDetailInput = z.infer<typeof WorkflowDetailInputSchema>;

// ── List Page Queries ───────────────────────────────────────────────────

export const getWorkflowsList = createServerFn({
  method: "GET",
})
  .inputValidator(WorkflowsListInputSchema)
  .handler(async ({ data }) => {
    const { fromDate, toDate, fromISO, toISO } = resolveTimeRange(
      data.timeRange,
    );
    const pageSize = data.pageSize ?? 20;
    const offset = (data.page - 1) * pageSize;

    // Calculate prior period: same width shifted back
    const periodMs = toDate.getTime() - fromDate.getTime();
    const prevFromDate = new Date(fromDate.getTime() - periodMs);
    const prevFromISO = prevFromDate
      .toISOString()
      .replace("T", " ")
      .replace("Z", "");

    const conditions: string[] = [
      "ResourceAttributes['cicd.pipeline.run.id'] != ''",
      "ResourceAttributes['cicd.pipeline.name'] != ''",
      "ResourceAttributes['cicd.pipeline.task.run.result'] != ''",
      "Timestamp >= {prevFromTime:String} AND Timestamp <= {toTime:String}",
    ];
    const params: Record<string, unknown> = {
      fromTime: fromISO,
      toTime: toISO,
      prevFromTime: prevFromISO,
      pageSize,
      offset,
    };

    if (data.repo) {
      conditions.push(
        "ResourceAttributes['vcs.repository.name'] = {repo:String}",
      );
      params.repo = data.repo;
    }
    if (data.search) {
      conditions.push(
        "ResourceAttributes['cicd.pipeline.name'] ILIKE {search:String}",
      );
      params.search = `%${data.search}%`;
    }

    const whereClause = conditions.join("\n\t\t\t\tAND ");

    const dataSql = `
			SELECT
				workflowName,
				repo,
				countIf(timestamp >= {fromTime:String}) as totalRuns,
				round(countIf(conclusion = 'success' AND timestamp >= {fromTime:String}) * 100.0
					/ nullIf(countIf(timestamp >= {fromTime:String}), 0), 1) as successRate,
				avgIf(duration, timestamp >= {fromTime:String}) as avgDuration,
				maxIf(timestamp, timestamp >= {fromTime:String}) as lastRunAt,
				countIf(timestamp < {fromTime:String}) as prevTotalRuns,
				round(countIf(conclusion = 'success' AND timestamp < {fromTime:String}) * 100.0
					/ nullIf(countIf(timestamp < {fromTime:String}), 0), 1) as prevSuccessRate,
				avgIf(duration, timestamp < {fromTime:String}) as prevAvgDuration
			FROM (
				SELECT
					ResourceAttributes['cicd.pipeline.run.id'] as run_id,
					anyLast(ResourceAttributes['cicd.pipeline.name']) as workflowName,
					anyLast(ResourceAttributes['vcs.repository.name']) as repo,
					anyLast(ResourceAttributes['cicd.pipeline.task.run.result']) as conclusion,
					max(Duration) / 1000000 as duration,
					max(Timestamp) as timestamp
				FROM traces
				WHERE ${whereClause}
				GROUP BY run_id
			)
			GROUP BY workflowName, repo
			ORDER BY lastRunAt DESC
			LIMIT {pageSize:UInt32} OFFSET {offset:UInt32}
		`;

    const countSql = `
			SELECT count(*) as total
			FROM (
				SELECT
					workflowName,
					repo
				FROM (
					SELECT
						ResourceAttributes['cicd.pipeline.run.id'] as run_id,
						anyLast(ResourceAttributes['cicd.pipeline.name']) as workflowName,
						anyLast(ResourceAttributes['vcs.repository.name']) as repo
					FROM traces
					WHERE ${whereClause}
					GROUP BY run_id
				)
				GROUP BY workflowName, repo
			)
		`;

    const [dataResult, countResult] = await Promise.all([
      query<{
        workflowName: string;
        repo: string;
        totalRuns: string;
        successRate: string;
        avgDuration: string;
        lastRunAt: string;
        prevTotalRuns: string;
        prevSuccessRate: string;
        prevAvgDuration: string;
      }>(dataSql, params),
      query<{ total: string }>(countSql, params),
    ]);

    return {
      workflows: dataResult.map((row) => ({
        workflowName: row.workflowName,
        repo: row.repo,
        totalRuns: Number(row.totalRuns),
        successRate: Number(row.successRate) || 0,
        avgDuration: Number(row.avgDuration),
        lastRunAt: row.lastRunAt,
        prevTotalRuns: Number(row.prevTotalRuns),
        prevSuccessRate: Number(row.prevSuccessRate) || 0,
        prevAvgDuration: Number(row.prevAvgDuration),
      })),
      totalCount: countResult.length > 0 ? Number(countResult[0].total) : 0,
    } satisfies WorkflowsListResult;
  });

export const getWorkflowsSparklines = createServerFn({
  method: "GET",
})
  .inputValidator(WorkflowsSparklineInputSchema)
  .handler(async ({ data }) => {
    const { fromDate, toDate, fromISO, toISO } = resolveTimeRange(
      data.timeRange,
    );

    if (data.workflows.length === 0) {
      return [] satisfies WorkflowSparklineData[];
    }

    const pairParams: Record<string, unknown> = {
      fromTime: fromISO,
      toTime: toISO,
    };
    const pairConditions = data.workflows
      .map((w, i) => {
        pairParams[`workflowName${i}`] = w.workflowName;
        pairParams[`repo${i}`] = w.repo;
        return `(ResourceAttributes['cicd.pipeline.name'] = {workflowName${i}:String}
          AND ResourceAttributes['vcs.repository.name'] = {repo${i}:String})`;
      })
      .join("\n\t\t\t\t\t\tOR ");

    const sql = `
			SELECT
				workflowName,
				repo,
				toDate(timestamp) as date,
				count(*) as totalRuns,
				round(countIf(conclusion = 'success') * 100.0 / nullIf(count(*), 0), 1) as successRate,
				avg(duration) as avgDuration
			FROM (
				SELECT
					ResourceAttributes['cicd.pipeline.run.id'] as run_id,
					anyLast(ResourceAttributes['cicd.pipeline.name']) as workflowName,
					anyLast(ResourceAttributes['vcs.repository.name']) as repo,
					anyLast(ResourceAttributes['cicd.pipeline.task.run.result']) as conclusion,
					max(Duration) / 1000000 as duration,
					max(Timestamp) as timestamp
				FROM traces
				WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
						AND ResourceAttributes['cicd.pipeline.run.id'] != ''
						AND ResourceAttributes['cicd.pipeline.name'] != ''
						AND ResourceAttributes['cicd.pipeline.task.run.result'] != ''
						AND (${pairConditions})
					GROUP BY run_id
			)
			GROUP BY workflowName, repo, date
			ORDER BY workflowName, repo, date ASC
		`;

    const result = await query<{
      workflowName: string;
      repo: string;
      date: string;
      totalRuns: string;
      successRate: string;
      avgDuration: string;
    }>(sql, pairParams);

    // Group results by workflow+repo
    const grouped = new Map<string, WorkflowSparklineData>();
    for (const row of result) {
      const key = `${row.workflowName}::${row.repo}`;
      let entry = grouped.get(key);
      if (!entry) {
        entry = {
          workflowName: row.workflowName,
          repo: row.repo,
          buckets: [],
        };
        grouped.set(key, entry);
      }
      entry.buckets.push({
        date: row.date,
        totalRuns: Number(row.totalRuns),
        successRate: Number(row.successRate) || 0,
        avgDuration: Number(row.avgDuration),
      });
    }

    // Fill missing dates so sparklines span the full time range
    for (const entry of grouped.values()) {
      const existingDates = new Set(entry.buckets.map((b) => b.date));
      for (
        const d = new Date(fromDate);
        d <= toDate;
        d.setDate(d.getDate() + 1)
      ) {
        const dateStr = d.toISOString().slice(0, 10);
        if (!existingDates.has(dateStr)) {
          entry.buckets.push({
            date: dateStr,
            totalRuns: 0,
            successRate: 0,
            avgDuration: 0,
          });
        }
      }
      entry.buckets.sort((a, b) => a.date.localeCompare(b.date));
    }

    return Array.from(grouped.values()) satisfies WorkflowSparklineData[];
  });

// ── Detail Page Queries ─────────────────────────────────────────────────

export const getWorkflowStats = createServerFn({
  method: "GET",
})
  .inputValidator(WorkflowDetailInputSchema)
  .handler(async ({ data }) => {
    const { fromDate, toDate, fromISO, toISO } = resolveTimeRange(
      data.timeRange,
    );

    const periodMs = toDate.getTime() - fromDate.getTime();
    const prevFromDate = new Date(fromDate.getTime() - periodMs);
    const prevFromISO = prevFromDate
      .toISOString()
      .replace("T", " ")
      .replace("Z", "");

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

    const result = await query<{
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

export const getWorkflowSuccessRateTrend = createServerFn({
  method: "GET",
})
  .inputValidator(WorkflowDetailInputSchema)
  .handler(async ({ data }) => {
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

    const result = await query<{
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

export const getWorkflowDurationTrend = createServerFn({
  method: "GET",
})
  .inputValidator(WorkflowDetailInputSchema)
  .handler(async ({ data }) => {
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

    const result = await query<{
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

export const getWorkflowTopFailingJobs = createServerFn({
  method: "GET",
})
  .inputValidator(WorkflowDetailInputSchema)
  .handler(async ({ data }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);

    const sql = `
			SELECT
				ResourceAttributes['cicd.pipeline.task.name'] as jobName,
				countIf(ResourceAttributes['cicd.pipeline.task.run.result'] = 'failure') as failureCount,
				count(*) as totalRuns,
				round(countIf(ResourceAttributes['cicd.pipeline.task.run.result'] = 'success') * 100.0
					/ nullIf(count(*), 0), 1) as successRate
			FROM traces
			WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
				AND ResourceAttributes['cicd.pipeline.name'] = {workflowName:String}
				AND ResourceAttributes['vcs.repository.name'] = {repo:String}
				AND ResourceAttributes['cicd.pipeline.task.name'] != ''
				AND SpanAttributes['everr.github.workflow_job_step.number'] = ''
				AND SpanAttributes['everr.test.name'] = ''
			GROUP BY jobName
			ORDER BY failureCount DESC
			LIMIT 10
		`;

    const result = await query<{
      jobName: string;
      failureCount: string;
      totalRuns: string;
      successRate: string;
    }>(sql, {
      fromTime: fromISO,
      toTime: toISO,
      workflowName: data.workflowName,
      repo: data.repo,
    });

    return result.map((row) => ({
      jobName: row.jobName,
      failureCount: Number(row.failureCount),
      totalRuns: Number(row.totalRuns),
      successRate: Number(row.successRate) || 0,
    })) satisfies WorkflowFailingJob[];
  });

export const getWorkflowFailureReasons = createServerFn({
  method: "GET",
})
  .inputValidator(WorkflowDetailInputSchema)
  .handler(async ({ data }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);

    const sql = `
			SELECT
				lower(trim(substring(StatusMessage, 1, 200))) as pattern,
				count(*) as count,
				max(Timestamp) as lastOccurrence
			FROM traces
			WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
				AND ResourceAttributes['cicd.pipeline.name'] = {workflowName:String}
				AND ResourceAttributes['vcs.repository.name'] = {repo:String}
				AND ResourceAttributes['cicd.pipeline.task.run.result'] = 'failure'
				AND SpanAttributes['everr.github.workflow_job_step.number'] = ''
				AND StatusMessage != ''
			GROUP BY pattern
			ORDER BY count DESC
			LIMIT 10
		`;

    const result = await query<{
      pattern: string;
      count: string;
      lastOccurrence: string;
    }>(sql, {
      fromTime: fromISO,
      toTime: toISO,
      workflowName: data.workflowName,
      repo: data.repo,
    });

    return result.map((row) => ({
      pattern: row.pattern,
      count: Number(row.count),
      lastOccurrence: row.lastOccurrence,
    })) satisfies WorkflowFailureReason[];
  });

export interface WorkflowCost {
  totalCost: number;
  totalMinutes: number;
  prevTotalCost: number;
  overTime: number[];
}

export const getWorkflowCost = createServerFn({
  method: "GET",
})
  .inputValidator(WorkflowDetailInputSchema)
  .handler(async ({ data }) => {
    const { fromDate, toDate, fromISO, toISO } = resolveTimeRange(
      data.timeRange,
    );
    const periodMs = toDate.getTime() - fromDate.getTime();
    const prevFromDate = new Date(fromDate.getTime() - periodMs);
    const prevFromISO = prevFromDate
      .toISOString()
      .replace("T", " ")
      .replace("Z", "");

    const [summaryRows, dailyRows] = await Promise.all([
      query<{
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
      query<{
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

export const getWorkflowRecentRuns = createServerFn({
  method: "GET",
})
  .inputValidator(WorkflowDetailInputSchema)
  .handler(async ({ data }) => {
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

    const result = await query<{
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
      timestamp: row.timestamp,
      sender: row.sender,
      jobCount: Number(row.jobCount),
    })) satisfies RunListItem[];
  });

// ── Query Options Factories ─────────────────────────────────────────────

export const workflowsListOptions = (input: WorkflowsListInput) =>
  queryOptions({
    queryKey: ["workflows", "list", input],
    queryFn: () => getWorkflowsList({ data: input }),
  });

export const workflowsSparklineOptions = (input: WorkflowsSparklineInput) =>
  queryOptions({
    queryKey: ["workflows", "sparklines", input],
    queryFn: () => getWorkflowsSparklines({ data: input }),
    enabled: input.workflows.length > 0,
  });

export const workflowStatsOptions = (input: WorkflowDetailInput) =>
  queryOptions({
    queryKey: ["workflows", "stats", input],
    queryFn: () => getWorkflowStats({ data: input }),
  });

export const workflowSuccessRateTrendOptions = (input: WorkflowDetailInput) =>
  queryOptions({
    queryKey: ["workflows", "successRateTrend", input],
    queryFn: () => getWorkflowSuccessRateTrend({ data: input }),
    staleTime: 60_000,
  });

export const workflowDurationTrendOptions = (input: WorkflowDetailInput) =>
  queryOptions({
    queryKey: ["workflows", "durationTrend", input],
    queryFn: () => getWorkflowDurationTrend({ data: input }),
    staleTime: 60_000,
  });

export const workflowTopFailingJobsOptions = (input: WorkflowDetailInput) =>
  queryOptions({
    queryKey: ["workflows", "topFailingJobs", input],
    queryFn: () => getWorkflowTopFailingJobs({ data: input }),
    staleTime: 60_000,
  });

export const workflowFailureReasonsOptions = (input: WorkflowDetailInput) =>
  queryOptions({
    queryKey: ["workflows", "failureReasons", input],
    queryFn: () => getWorkflowFailureReasons({ data: input }),
    staleTime: 60_000,
  });

export const workflowCostOptions = (input: WorkflowDetailInput) =>
  queryOptions({
    queryKey: ["workflows", "cost", input],
    queryFn: () => getWorkflowCost({ data: input }),
    staleTime: 60_000,
  });

export const workflowRecentRunsOptions = (input: WorkflowDetailInput) =>
  queryOptions({
    queryKey: ["workflows", "recentRuns", input],
    queryFn: () => getWorkflowRecentRuns({ data: input }),
  });
