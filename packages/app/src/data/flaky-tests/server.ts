import { z } from "zod";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { resolveTimeRange } from "@/lib/time-range";
import { testFullNameExpr } from "../sql-helpers";
import type { TestExecution } from "./schemas";
import { TestHistoryInputSchema } from "./schemas";

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

// Lightweight lookup for waterfall badge
export const getFlakyTestNames = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(z.object({ repo: z.string() }))
  .handler(async ({ data: { repo }, context: { clickhouse } }) => {
    const sql = `
			SELECT DISTINCT test_full_name
			FROM (
				SELECT
					test_full_name,
					countIf(test_result = 'fail') as fail_count,
					countIf(test_result = 'pass') as pass_count
				FROM (
					SELECT
						${testFullNameExpr()},
						ResourceAttributes['cicd.pipeline.run.id'] as run_id,
						ResourceAttributes['vcs.ref.head.revision'] as head_sha,
						anyLast(SpanAttributes['everr.test.result']) as test_result
					FROM traces
					WHERE Timestamp >= now() - INTERVAL 30 DAY
						AND SpanAttributes['everr.test.name'] != ''
						AND SpanAttributes['everr.test.result'] IN ('pass', 'fail')
						AND ResourceAttributes['vcs.repository.name'] = {repo:String}
					GROUP BY test_full_name, run_id, head_sha
				)
				GROUP BY test_full_name
				HAVING fail_count > 0 AND pass_count > 0
			)
		`;

    const result = await clickhouse.query<{ test_full_name: string }>(sql, {
      repo,
    });
    return result.map((row) => row.test_full_name);
  });
