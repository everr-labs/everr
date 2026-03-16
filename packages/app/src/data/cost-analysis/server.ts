import { TimeRangeInputSchema } from "@/data/analytics/schemas";
import { query } from "@/lib/clickhouse";
import { calculateCost } from "@/lib/runner-pricing";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { resolveTimeRange } from "@/lib/time-range";
import type {
  CostByRepo,
  CostByRunner,
  CostByWorkflow,
  CostOverTimePoint,
  CostSummary,
} from "./schemas";

export const getCostOverview = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TimeRangeInputSchema)
  .handler(async ({ data: { timeRange } }) => {
    const { fromISO, toISO, fromDate, toDate } = resolveTimeRange(timeRange);

    const sql = `
      SELECT
        toDate(Timestamp) as date,
        ResourceAttributes['cicd.pipeline.worker.labels'] as labels,
        count(*) as totalJobs,
        sum(Duration) / 1000000 as totalDurationMs,
        sum(ceil(Duration / 60000000000.0)) as roundedMinutes
      FROM traces
      WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
        AND ResourceAttributes['cicd.pipeline.worker.labels'] != ''
        AND ResourceAttributes['cicd.pipeline.task.run.id'] != ''
        AND lowerUTF8(ResourceAttributes['cicd.pipeline.task.run.result']) != 'skip'
        AND SpanAttributes['everr.github.workflow_job_step.number'] = ''
        AND SpanAttributes['everr.test.name'] = ''
      GROUP BY date, labels
      ORDER BY date ASC, totalDurationMs DESC
    `;

    const rows = await query<{
      date: string;
      labels: string;
      totalJobs: string;
      totalDurationMs: string;
      roundedMinutes: string;
    }>(sql, { fromTime: fromISO, toTime: toISO });

    const summary: CostSummary = {
      totalCost: 0,
      totalMinutes: 0,
      totalBillingMinutes: 0,
      totalJobs: 0,
      costByOs: [],
      selfHostedMinutes: 0,
      selfHostedJobs: 0,
    };

    const overTimeMap = new Map<string, CostOverTimePoint>();
    const byRunnerMap = new Map<string, CostByRunner>();
    const osCostMap = new Map<string, { cost: number; jobs: number }>();

    for (const row of rows) {
      const jobs = Number(row.totalJobs);
      const durationMs = Number(row.totalDurationMs);
      const roundedMinutes = Number(row.roundedMinutes);
      const costResult = calculateCost(row.labels, durationMs, roundedMinutes);

      // Summary
      summary.totalCost += costResult.estimatedCost;
      summary.totalMinutes += costResult.actualMinutes;
      summary.totalBillingMinutes += costResult.billingMinutes;
      summary.totalJobs += jobs;

      if (costResult.pricing.isSelfHosted) {
        summary.selfHostedMinutes += costResult.actualMinutes;
        summary.selfHostedJobs += jobs;
      }

      const osEntry = osCostMap.get(costResult.pricing.os) ?? {
        cost: 0,
        jobs: 0,
      };
      osEntry.cost += costResult.estimatedCost;
      osEntry.jobs += jobs;
      osCostMap.set(costResult.pricing.os, osEntry);

      // Over time
      const point = overTimeMap.get(row.date) ?? {
        date: row.date,
        totalCost: 0,
        linuxCost: 0,
        windowsCost: 0,
        macosCost: 0,
        selfHostedMinutes: 0,
      };
      point.totalCost += costResult.estimatedCost;
      if (costResult.pricing.os === "linux")
        point.linuxCost += costResult.estimatedCost;
      if (costResult.pricing.os === "windows")
        point.windowsCost += costResult.estimatedCost;
      if (costResult.pricing.os === "macos")
        point.macosCost += costResult.estimatedCost;
      if (costResult.pricing.isSelfHosted)
        point.selfHostedMinutes += costResult.actualMinutes;
      overTimeMap.set(row.date, point);

      // By runner
      const runner = byRunnerMap.get(row.labels) ?? {
        labels: row.labels,
        tier: costResult.pricing.tier,
        os: costResult.pricing.os,
        isSelfHosted: costResult.pricing.isSelfHosted,
        totalJobs: 0,
        totalMinutes: 0,
        billingMinutes: 0,
        estimatedCost: 0,
        ratePerMinute: costResult.pricing.ratePerMinute,
      };
      runner.totalJobs += jobs;
      runner.totalMinutes += costResult.actualMinutes;
      runner.billingMinutes += costResult.billingMinutes;
      runner.estimatedCost += costResult.estimatedCost;
      byRunnerMap.set(row.labels, runner);
    }

    summary.costByOs = Array.from(osCostMap.entries()).map(
      ([os, { cost, jobs }]) => ({ os, cost, jobs }),
    );

    // Fill missing dates
    for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      if (!overTimeMap.has(dateStr)) {
        overTimeMap.set(dateStr, {
          date: dateStr,
          totalCost: 0,
          linuxCost: 0,
          windowsCost: 0,
          macosCost: 0,
          selfHostedMinutes: 0,
        });
      }
    }

    const overTime = Array.from(overTimeMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    const byRunner = Array.from(byRunnerMap.values()).sort(
      (a, b) => b.estimatedCost - a.estimatedCost,
    );

    return { summary, overTime, byRunner };
  });

export const getCostByRepo = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TimeRangeInputSchema)
  .handler(async ({ data: { timeRange } }) => {
    const { fromISO, toISO } = resolveTimeRange(timeRange);

    const sql = `
      SELECT
        ResourceAttributes['vcs.repository.name'] as repo,
        ResourceAttributes['cicd.pipeline.worker.labels'] as labels,
        count(*) as totalJobs,
        sum(Duration) / 1000000 as totalDurationMs,
        sum(ceil(Duration / 60000000000.0)) as roundedMinutes
      FROM traces
      WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
        AND ResourceAttributes['cicd.pipeline.worker.labels'] != ''
        AND ResourceAttributes['cicd.pipeline.task.run.id'] != ''
        AND lowerUTF8(ResourceAttributes['cicd.pipeline.task.run.result']) != 'skip'
        AND SpanAttributes['everr.github.workflow_job_step.number'] = ''
        AND SpanAttributes['everr.test.name'] = ''
        AND ResourceAttributes['vcs.repository.name'] != ''
      GROUP BY repo, labels
      ORDER BY totalDurationMs DESC
    `;

    const rows = await query<{
      repo: string;
      labels: string;
      totalJobs: string;
      totalDurationMs: string;
      roundedMinutes: string;
    }>(sql, { fromTime: fromISO, toTime: toISO });

    const repoMap = new Map<string, CostByRepo & { topRunnerCost: number }>();

    for (const row of rows) {
      const jobs = Number(row.totalJobs);
      const durationMs = Number(row.totalDurationMs);
      const roundedMinutes = Number(row.roundedMinutes);
      const costResult = calculateCost(row.labels, durationMs, roundedMinutes);

      const existing = repoMap.get(row.repo) ?? {
        repo: row.repo,
        totalJobs: 0,
        totalMinutes: 0,
        billingMinutes: 0,
        estimatedCost: 0,
        topRunner: row.labels,
        topRunnerCost: 0,
      };

      existing.totalJobs += jobs;
      existing.totalMinutes += costResult.actualMinutes;
      existing.billingMinutes += costResult.billingMinutes;
      existing.estimatedCost += costResult.estimatedCost;

      if (costResult.estimatedCost > existing.topRunnerCost) {
        existing.topRunner = row.labels;
        existing.topRunnerCost = costResult.estimatedCost;
      }

      repoMap.set(row.repo, existing);
    }

    return Array.from(repoMap.values())
      .map(({ topRunnerCost: _, ...rest }) => rest)
      .sort((a, b) => b.estimatedCost - a.estimatedCost) satisfies CostByRepo[];
  });

export const getCostByWorkflow = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TimeRangeInputSchema)
  .handler(async ({ data: { timeRange } }) => {
    const { fromISO, toISO } = resolveTimeRange(timeRange);

    const sql = `
      SELECT
        ResourceAttributes['vcs.repository.name'] as repo,
        ResourceAttributes['cicd.pipeline.name'] as workflow,
        ResourceAttributes['cicd.pipeline.worker.labels'] as labels,
        count(*) as totalJobs,
        sum(Duration) / 1000000 as totalDurationMs,
        sum(ceil(Duration / 60000000000.0)) as roundedMinutes,
        uniqExact(ResourceAttributes['cicd.pipeline.run.id']) as uniqueRuns
      FROM traces
      WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
        AND ResourceAttributes['cicd.pipeline.worker.labels'] != ''
        AND ResourceAttributes['cicd.pipeline.task.run.id'] != ''
        AND lowerUTF8(ResourceAttributes['cicd.pipeline.task.run.result']) != 'skip'
        AND SpanAttributes['everr.github.workflow_job_step.number'] = ''
        AND SpanAttributes['everr.test.name'] = ''
        AND ResourceAttributes['vcs.repository.name'] != ''
        AND ResourceAttributes['cicd.pipeline.name'] != ''
      GROUP BY repo, workflow, labels
      ORDER BY totalDurationMs DESC
    `;

    const rows = await query<{
      repo: string;
      workflow: string;
      labels: string;
      totalJobs: string;
      totalDurationMs: string;
      roundedMinutes: string;
      uniqueRuns: string;
    }>(sql, { fromTime: fromISO, toTime: toISO });

    const workflowMap = new Map<
      string,
      Omit<CostByWorkflow, "avgCostPerRun"> & { maxUniqueRuns: number }
    >();

    for (const row of rows) {
      const key = `${row.repo}:${row.workflow}`;
      const jobs = Number(row.totalJobs);
      const durationMs = Number(row.totalDurationMs);
      const roundedMinutes = Number(row.roundedMinutes);
      const runs = Number(row.uniqueRuns);
      const costResult = calculateCost(row.labels, durationMs, roundedMinutes);

      const existing = workflowMap.get(key) ?? {
        repo: row.repo,
        workflow: row.workflow,
        totalJobs: 0,
        totalMinutes: 0,
        billingMinutes: 0,
        estimatedCost: 0,
        maxUniqueRuns: 0,
      };

      existing.totalJobs += jobs;
      existing.totalMinutes += costResult.actualMinutes;
      existing.billingMinutes += costResult.billingMinutes;
      existing.estimatedCost += costResult.estimatedCost;
      existing.maxUniqueRuns = Math.max(existing.maxUniqueRuns, runs);

      workflowMap.set(key, existing);
    }

    return Array.from(workflowMap.values())
      .map(({ maxUniqueRuns, ...rest }) => ({
        ...rest,
        avgCostPerRun:
          maxUniqueRuns > 0 ? rest.estimatedCost / maxUniqueRuns : 0,
      }))
      .sort(
        (a, b) => b.estimatedCost - a.estimatedCost,
      ) satisfies CostByWorkflow[];
  });
