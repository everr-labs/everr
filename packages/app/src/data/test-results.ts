import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { resolveTimeRange } from "@/lib/time-range";
import { testFullNameExpr } from "./sql-helpers";
import {
  buildFilterConditions,
  type TestPerformanceFilterInput,
  TestPerformanceFilterSchema,
} from "./test-performance/filters";

interface TestResultsSummary {
  totalTests: number;
  passCount: number;
  failCount: number;
  skipCount: number;
  passRate: number;
}

const getTestResultsSummary = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(
    TestPerformanceFilterSchema.extend({
      includeSkipped: z.boolean().optional(),
    }),
  )
  .handler(async ({ data, context: { clickhouse } }) => {
    const { timeRange, includeSkipped = true } = data;
    const { fromISO, toISO } = resolveTimeRange(timeRange);
    const { conditions, params, scopeConditions } = buildFilterConditions(
      fromISO,
      toISO,
      data,
      { includeSkipResults: includeSkipped },
    );
    const whereClause = conditions.join("\n\t\t\t\t\tAND ");
    const scopeWhere =
      scopeConditions.length > 0
        ? `WHERE ${scopeConditions.join("\n\t\t\t\t\tAND ")}`
        : "";

    const sql = `
			SELECT
				uniqExact(test_full_name) as totalTests,
				countIf(test_result = 'pass') as passCount,
				countIf(test_result = 'fail') as failCount,
				countIf(test_result = 'skip') as skipCount,
				round(
					countIf(test_result = 'pass') * 100.0
					/ nullIf(countIf(test_result = 'pass') + countIf(test_result = 'fail'), 0),
					1
				) as passRate
			FROM (
				SELECT
					${testFullNameExpr()},
					ResourceAttributes['cicd.pipeline.run.id'] as run_id,
					ResourceAttributes['vcs.ref.head.revision'] as head_sha,
					anyLast(SpanAttributes['everr.test.result']) as test_result
				FROM traces
				WHERE ${whereClause}
				GROUP BY test_full_name, run_id, head_sha
			)
			${scopeWhere}
		`;

    const result = await clickhouse.query<{
      totalTests: string;
      passCount: string;
      failCount: string;
      skipCount: string;
      passRate: string;
    }>(sql, params);

    if (result.length === 0) {
      return {
        totalTests: 0,
        passCount: 0,
        failCount: 0,
        skipCount: 0,
        passRate: 0,
      } satisfies TestResultsSummary;
    }

    return {
      totalTests: Number(result[0].totalTests),
      passCount: Number(result[0].passCount),
      failCount: Number(result[0].failCount),
      skipCount: Number(result[0].skipCount),
      passRate: Number(result[0].passRate) || 0,
    } satisfies TestResultsSummary;
  });

export interface TestDurationTrendPoint {
  date: string;
  avgDuration: number;
  p50Duration: number;
  p95Duration: number;
}

// Query options factories
export const testResultsSummaryOptions = (
  input: TestPerformanceFilterInput & { includeSkipped?: boolean },
) =>
  queryOptions({
    queryKey: ["testResults", "summary", input],
    queryFn: () => getTestResultsSummary({ data: input }),
  });
