import { z } from "zod";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { resolveTimeRange, TimeRangeSchema } from "@/lib/time-range";
import { leafTestFilter, testFullNameExpr } from "./sql-helpers";

const SlowestQueryInputSchema = z.object({
  timeRange: TimeRangeSchema,
  repo: z.string().min(1),
  branch: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  offset: z.coerce.number().int().min(0).default(0),
});

export type SlowestQueryInput = z.infer<typeof SlowestQueryInputSchema>;

export interface SlowTestItem {
  testPackage: string;
  testFullName: string;
  avgDurationSeconds: number;
  p95DurationSeconds: number;
  maxDurationSeconds: number;
  executions: number;
  passCount: number;
  failCount: number;
  skipCount: number;
  lastSeen: string;
}

export interface SlowestTestsResult {
  repo: string;
  branch: string | null;
  timeRange: {
    from: string;
    to: string;
  };
  limit: number;
  items: SlowTestItem[];
}

export interface SlowJobItem {
  workflowName: string;
  jobName: string;
  avgDurationSeconds: number;
  p95DurationSeconds: number;
  maxDurationSeconds: number;
  executions: number;
  successCount: number;
  failureCount: number;
  skipCount: number;
  lastSeen: string;
}

export interface SlowestJobsResult {
  repo: string;
  branch: string | null;
  timeRange: {
    from: string;
    to: string;
  };
  limit: number;
  items: SlowJobItem[];
}

export const getSlowestTests = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(SlowestQueryInputSchema)
  .handler(
    async ({
      data,
      context: {
        clickhouse: { query },
      },
    }) => {
      const limit = data.limit ?? 10;
      const offset = data.offset ?? 0;
      const { fromISO, toISO } = resolveTimeRange(data.timeRange);
      const conditions = [
        "Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}",
        "SpanAttributes['everr.test.name'] != ''",
        "SpanAttributes['everr.test.result'] IN ('pass', 'fail', 'skip')",
        "lowerUTF8(SpanAttributes['everr.test.is_suite']) IN ('false', '0')",
        "ResourceAttributes['vcs.repository.name'] = {repo:String}",
      ];
      const params: Record<string, unknown> = {
        fromTime: fromISO,
        toTime: toISO,
        repo: data.repo,
        limit,
        offset,
      };
      const leafScopeConditions = [
        "ResourceAttributes['vcs.repository.name'] = {repo:String}",
      ];
      const normalizedTestFullNameExpr = testFullNameExpr(
        "test_full_name",
        "replaceAll(SpanAttributes['everr.test.parent_test'], ' > ', '/')",
      );

      if (data.branch) {
        conditions.push(
          "ResourceAttributes['vcs.ref.head.name'] = {branch:String}",
        );
        params.branch = data.branch;
        leafScopeConditions.push(
          "ResourceAttributes['vcs.ref.head.name'] = {branch:String}",
        );
      }

      const sql = `
      WITH executions AS (
        SELECT
          SpanAttributes['everr.test.package'] as test_package,
          ${normalizedTestFullNameExpr},
          ResourceAttributes['cicd.pipeline.run.id'] as run_id,
          ResourceAttributes['vcs.ref.head.revision'] as head_sha,
          anyLast(SpanAttributes['everr.test.result']) as test_result,
          anyLast(toFloat64OrZero(SpanAttributes['everr.test.duration_seconds'])) as test_duration,
          max(Timestamp) as last_seen
        FROM traces
        WHERE ${conditions.join("\n          AND ")}
        GROUP BY test_package, test_full_name, run_id, head_sha
      )
      SELECT
        test_package,
        test_full_name,
        avg(test_duration) as avg_duration,
        quantile(0.95)(test_duration) as p95_duration,
        max(test_duration) as max_duration,
        count(*) as executions,
        countIf(test_result = 'pass') as pass_count,
        countIf(test_result = 'fail') as fail_count,
        countIf(test_result = 'skip') as skip_count,
        max(last_seen) as last_seen
      FROM executions
      WHERE ${leafTestFilter({
        leftExpr: "tuple(test_package, test_full_name)",
        rightExpr:
          "tuple(SpanAttributes['everr.test.package'], replaceAll(SpanAttributes['everr.test.parent_test'], ' > ', '/'))",
        extraConditions: leafScopeConditions,
      })}
      GROUP BY test_package, test_full_name
      ORDER BY
        avg_duration DESC,
        p95_duration DESC,
        executions DESC,
        test_full_name ASC
      LIMIT {limit:UInt32} OFFSET {offset:UInt32}
    `;

      const result = await query<{
        test_package: string;
        test_full_name: string;
        avg_duration: string;
        p95_duration: string;
        max_duration: string;
        executions: string;
        pass_count: string;
        fail_count: string;
        skip_count: string;
        last_seen: string;
      }>(sql, params);

      return {
        repo: data.repo,
        branch: data.branch ?? null,
        timeRange: data.timeRange,
        limit,
        items: result.map((row) => ({
          testPackage: row.test_package,
          testFullName: row.test_full_name,
          avgDurationSeconds: Number(row.avg_duration),
          p95DurationSeconds: Number(row.p95_duration),
          maxDurationSeconds: Number(row.max_duration),
          executions: Number(row.executions),
          passCount: Number(row.pass_count),
          failCount: Number(row.fail_count),
          skipCount: Number(row.skip_count),
          lastSeen: row.last_seen,
        })),
      } satisfies SlowestTestsResult;
    },
  );

export const getSlowestJobs = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(SlowestQueryInputSchema)
  .handler(
    async ({
      data,
      context: {
        clickhouse: { query },
      },
    }) => {
      const limit = data.limit ?? 10;
      const offset = data.offset ?? 0;
      const { fromISO, toISO } = resolveTimeRange(data.timeRange);
      const conditions = [
        "Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}",
        "ResourceAttributes['cicd.pipeline.task.run.id'] != ''",
        "SpanAttributes['everr.github.workflow_job_step.number'] = ''",
        "SpanAttributes['everr.test.name'] = ''",
        "ResourceAttributes['vcs.repository.name'] = {repo:String}",
      ];
      const params: Record<string, unknown> = {
        fromTime: fromISO,
        toTime: toISO,
        repo: data.repo,
        limit,
        offset,
      };

      if (data.branch) {
        conditions.push(
          "ResourceAttributes['vcs.ref.head.name'] = {branch:String}",
        );
        params.branch = data.branch;
      }

      const sql = `
      WITH job_executions AS (
        SELECT
          anyLast(ResourceAttributes['cicd.pipeline.name']) as workflow_name,
          anyLast(ResourceAttributes['cicd.pipeline.task.name']) as job_name,
          anyLast(ResourceAttributes['cicd.pipeline.task.run.result']) as conclusion,
          if(
            lowerUTF8(anyLast(ResourceAttributes['cicd.pipeline.task.run.result'])) = 'skip',
            0,
            max(Duration) / 1000000000
          ) as job_duration,
          max(Timestamp) as last_seen
        FROM traces
        WHERE ${conditions.join("\n          AND ")}
        GROUP BY ResourceAttributes['cicd.pipeline.task.run.id']
      )
      SELECT
        workflow_name,
        job_name,
        avg(job_duration) as avg_duration,
        quantile(0.95)(job_duration) as p95_duration,
        max(job_duration) as max_duration,
        count(*) as executions,
        countIf(lowerUTF8(conclusion) = 'success') as success_count,
        countIf(lowerUTF8(conclusion) IN ('failure', 'failed')) as failure_count,
        countIf(lowerUTF8(conclusion) = 'skip') as skip_count,
        max(last_seen) as last_seen
      FROM job_executions
      GROUP BY workflow_name, job_name
      ORDER BY
        avg_duration DESC,
        p95_duration DESC,
        executions DESC,
        workflow_name ASC,
        job_name ASC
      LIMIT {limit:UInt32} OFFSET {offset:UInt32}
    `;

      const result = await query<{
        workflow_name: string;
        job_name: string;
        avg_duration: string;
        p95_duration: string;
        max_duration: string;
        executions: string;
        success_count: string;
        failure_count: string;
        skip_count: string;
        last_seen: string;
      }>(sql, params);

      return {
        repo: data.repo,
        branch: data.branch ?? null,
        timeRange: data.timeRange,
        limit,
        items: result.map((row) => ({
          workflowName: row.workflow_name || "Workflow",
          jobName: row.job_name || "Job",
          avgDurationSeconds: Number(row.avg_duration),
          p95DurationSeconds: Number(row.p95_duration),
          maxDurationSeconds: Number(row.max_duration),
          executions: Number(row.executions),
          successCount: Number(row.success_count),
          failureCount: Number(row.failure_count),
          skipCount: Number(row.skip_count),
          lastSeen: row.last_seen,
        })),
      } satisfies SlowestJobsResult;
    },
  );
