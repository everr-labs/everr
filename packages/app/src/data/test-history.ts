import { z } from "zod";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { resolveTimeRange, TimeRangeSchema } from "@/lib/time-range";
import { testFullNameExpr } from "./sql-helpers";

interface TestExecution {
  traceId: string;
  runId: string;
  runAttempt: number;
  headSha: string;
  headBranch: string;
  testResult: string;
  testDuration: number;
  runnerName: string;
  workflowName: string;
  jobName: string;
  timestamp: string;
}

const TestHistoryInputSchema = z
  .object({
    timeRange: TimeRangeSchema,
    repo: z.string(),
    testFullName: z.string().optional(),
    testModule: z.string().optional(),
    testName: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .superRefine((value, ctx) => {
    const hasFullName = Boolean(value.testFullName);
    const hasTestModule = Boolean(value.testModule);
    const hasTestName = Boolean(value.testName);
    if (!hasFullName && !hasTestModule && !hasTestName) {
      ctx.addIssue({
        code: "custom",
        message: "Provide testFullName, testModule, or testName.",
      });
    }
  });

export const getTestHistory = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TestHistoryInputSchema)
  .handler(
    async ({
      data: {
        timeRange,
        repo,
        testFullName,
        testModule,
        testName,
        limit = 100,
        offset = 0,
      },
      context: { clickhouse },
    }) => {
      const { fromISO, toISO } = resolveTimeRange(timeRange);
      const whereConditions = [
        "Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}",
        "SpanAttributes['everr.test.name'] != ''",
        "ResourceAttributes['vcs.repository.name'] = {repo:String}",
      ];
      const params: Record<string, unknown> = {
        repo,
        fromTime: fromISO,
        toTime: toISO,
        limit,
        offset,
      };

      if (testFullName) {
        whereConditions.push(
          `${testFullNameExpr(null)} = {testFullName:String}`,
        );
        params.testFullName = testFullName;
      }
      if (testModule) {
        whereConditions.push(
          "SpanAttributes['everr.test.parent_test'] = {testModule:String}",
        );
        params.testModule = testModule;
      }
      if (testName) {
        whereConditions.push(
          "SpanAttributes['everr.test.name'] ILIKE {testNamePattern:String}",
        );
        params.testNamePattern = `%${testName}%`;
      }
      const whereClause = whereConditions.join("\n\t\t\t\t\tAND ");

      const sql = `
			SELECT
				trace_id,
				run_id,
				run_attempt,
				head_sha,
				head_branch,
				test_result,
				test_duration,
				runner_name,
				workflow_name,
				job_name,
				timestamp
			FROM (
				SELECT
					TraceId as trace_id,
					anyLast(ResourceAttributes['cicd.pipeline.run.id']) as run_id,
					toUInt32OrZero(anyLast(ResourceAttributes['everr.github.workflow_job.run_attempt'])) as run_attempt,
					anyLast(ResourceAttributes['vcs.ref.head.revision']) as head_sha,
					anyLast(ResourceAttributes['vcs.ref.head.name']) as head_branch,
					anyLast(SpanAttributes['everr.test.result']) as test_result,
					anyLast(toFloat64OrZero(SpanAttributes['everr.test.duration_seconds'])) as test_duration,
					anyLast(ResourceAttributes['cicd.worker.name']) as runner_name,
					anyLast(ResourceAttributes['cicd.pipeline.name']) as workflow_name,
					anyLast(ResourceAttributes['cicd.pipeline.task.name']) as job_name,
					max(Timestamp) as timestamp
				FROM traces
				WHERE ${whereClause}
				GROUP BY trace_id
			)
			ORDER BY timestamp DESC
			LIMIT {limit:UInt32} OFFSET {offset:UInt32}
		`;

      const result = await clickhouse.query<{
        trace_id: string;
        run_id: string;
        run_attempt: string;
        head_sha: string;
        head_branch: string;
        test_result: string;
        test_duration: string;
        runner_name: string;
        workflow_name: string;
        job_name: string;
        timestamp: string;
      }>(sql, params);

      return result.map((row) => ({
        traceId: row.trace_id,
        runId: row.run_id,
        runAttempt: Number(row.run_attempt),
        headSha: row.head_sha,
        headBranch: row.head_branch,
        testResult: row.test_result,
        testDuration: Number(row.test_duration),
        runnerName: row.runner_name,
        workflowName: row.workflow_name,
        jobName: row.job_name,
        timestamp: row.timestamp,
      })) satisfies TestExecution[];
    },
  );
