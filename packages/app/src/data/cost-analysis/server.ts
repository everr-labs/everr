import * as z from "zod";
import { TimeRangeInputSchema } from "@/data/analytics/schemas";
import { calculateCost } from "@/lib/runner-pricing";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import {
  type BucketGranularity,
  getBucketGranularity,
  resolveTimeRange,
} from "@/lib/time-range";
import {
  BREAKDOWN_OTHER_KEY,
  type CostByWorkflow,
  type CostOverTimeBreakdown,
  type CostSummary,
} from "./schemas";

function bucketExpr(granularity: BucketGranularity): string {
  return granularity === "hour"
    ? "formatDateTime(toStartOfHour(Timestamp), '%Y-%m-%dT%H:00:00Z')"
    : "formatDateTime(toStartOfDay(Timestamp), '%Y-%m-%dT00:00:00Z')";
}

function floorToBucket(date: Date, granularity: BucketGranularity): Date {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  if (granularity === "day") d.setUTCHours(0);
  return d;
}

function advanceBucket(date: Date, granularity: BucketGranularity): void {
  if (granularity === "hour") {
    date.setUTCHours(date.getUTCHours() + 1);
  } else {
    date.setUTCDate(date.getUTCDate() + 1);
  }
}

function bucketIso(date: Date): string {
  return `${date.toISOString().slice(0, 13)}:00:00Z`;
}

export const getCostOverview = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TimeRangeInputSchema)
  .handler(async ({ data: { timeRange }, context: { clickhouse } }) => {
    const { fromISO, toISO } = resolveTimeRange(timeRange);

    const sql = `
      SELECT
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
      GROUP BY labels
    `;

    const rows = await clickhouse.query<{
      labels: string;
      totalJobs: string;
      totalDurationMs: string;
      roundedMinutes: string;
    }>(sql, { fromTime: fromISO, toTime: toISO });

    const summary: CostSummary = {
      totalCost: 0,
      totalMinutes: 0,
      totalJobs: 0,
      costByOs: [],
      selfHostedMinutes: 0,
      selfHostedJobs: 0,
    };

    const osCostMap = new Map<string, { cost: number; jobs: number }>();

    for (const row of rows) {
      const jobs = Number(row.totalJobs);
      const durationMs = Number(row.totalDurationMs);
      const roundedMinutes = Number(row.roundedMinutes);
      const costResult = calculateCost(row.labels, durationMs, roundedMinutes);

      summary.totalCost += costResult.estimatedCost;
      summary.totalMinutes += costResult.actualMinutes;
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
    }

    summary.costByOs = Array.from(osCostMap.entries()).map(
      ([os, { cost, jobs }]) => ({ os, cost, jobs }),
    );

    return { summary };
  });

export const getCostByWorkflow = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TimeRangeInputSchema)
  .handler(async ({ data: { timeRange }, context: { clickhouse } }) => {
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

    const rows = await clickhouse.query<{
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
        estimatedCost: 0,
        maxUniqueRuns: 0,
      };

      existing.totalJobs += jobs;
      existing.totalMinutes += costResult.actualMinutes;
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

const BREAKDOWN_TOP_N = 6;

const BreakdownInputSchema = TimeRangeInputSchema.extend({
  dimension: z.enum(["repo", "runner"]),
});

export const getCostOverTimeBreakdown = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(BreakdownInputSchema)
  .handler(
    async ({
      data: { timeRange, dimension },
      context: { clickhouse },
    }): Promise<CostOverTimeBreakdown> => {
      const { fromISO, toISO, fromDate, toDate } = resolveTimeRange(timeRange);
      const granularity = getBucketGranularity(fromDate, toDate);
      const keyExpr =
        dimension === "repo"
          ? "ResourceAttributes['vcs.repository.name']"
          : "ResourceAttributes['cicd.pipeline.worker.labels']";

      const sql = `
      SELECT
        ${bucketExpr(granularity)} as date,
        ${keyExpr} as series,
        ResourceAttributes['cicd.pipeline.worker.labels'] as labels,
        sum(Duration) / 1000000 as totalDurationMs,
        sum(ceil(Duration / 60000000000.0)) as roundedMinutes
      FROM traces
      WHERE Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}
        AND ResourceAttributes['cicd.pipeline.worker.labels'] != ''
        AND ResourceAttributes['cicd.pipeline.task.run.id'] != ''
        AND lowerUTF8(ResourceAttributes['cicd.pipeline.task.run.result']) != 'skip'
        AND SpanAttributes['everr.github.workflow_job_step.number'] = ''
        AND SpanAttributes['everr.test.name'] = ''
        AND ${keyExpr} != ''
      GROUP BY date, series, labels
      ORDER BY date ASC
    `;

      const rows = await clickhouse.query<{
        date: string;
        series: string;
        labels: string;
        totalDurationMs: string;
        roundedMinutes: string;
      }>(sql, { fromTime: fromISO, toTime: toISO });

      const totalsByKey = new Map<string, number>();
      const byDateKey = new Map<
        string,
        Map<string, { cost: number; minutes: number }>
      >();

      for (const row of rows) {
        const durationMs = Number(row.totalDurationMs);
        const roundedMinutes = Number(row.roundedMinutes);
        const result = calculateCost(row.labels, durationMs, roundedMinutes);

        totalsByKey.set(
          row.series,
          (totalsByKey.get(row.series) ?? 0) + result.estimatedCost,
        );

        const dateMap = byDateKey.get(row.date) ?? new Map();
        const existing = dateMap.get(row.series) ?? { cost: 0, minutes: 0 };
        existing.cost += result.estimatedCost;
        existing.minutes += result.actualMinutes;
        dateMap.set(row.series, existing);
        byDateKey.set(row.date, dateMap);
      }

      const sortedKeys = Array.from(totalsByKey.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([key]) => key);

      const topKeys = sortedKeys.slice(0, BREAKDOWN_TOP_N);
      const hasOther = sortedKeys.length > BREAKDOWN_TOP_N;
      const otherKeys = new Set(sortedKeys.slice(BREAKDOWN_TOP_N));

      const buckets = new Set(byDateKey.keys());
      for (
        const d = floorToBucket(fromDate, granularity);
        d <= toDate;
        advanceBucket(d, granularity)
      ) {
        buckets.add(bucketIso(d));
      }

      const points: CostOverTimeBreakdown["points"] = Array.from(buckets)
        .sort((a, b) => a.localeCompare(b))
        .map((date) => {
          const cost: Record<string, number> = {};
          const minutes: Record<string, number> = {};
          for (const key of topKeys) {
            cost[key] = 0;
            minutes[key] = 0;
          }
          if (hasOther) {
            cost[BREAKDOWN_OTHER_KEY] = 0;
            minutes[BREAKDOWN_OTHER_KEY] = 0;
          }
          const dateMap = byDateKey.get(date);
          if (dateMap) {
            for (const [key, value] of dateMap) {
              if (otherKeys.has(key)) {
                cost[BREAKDOWN_OTHER_KEY] += value.cost;
                minutes[BREAKDOWN_OTHER_KEY] += value.minutes;
              } else if (topKeys.includes(key)) {
                cost[key] = value.cost;
                minutes[key] = value.minutes;
              }
            }
          }
          return { date, cost, minutes };
        });

      return { granularity, topKeys, hasOther, points };
    },
  );
