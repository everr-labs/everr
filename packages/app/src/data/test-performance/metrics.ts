import { queryOptions } from "@tanstack/react-query";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import {
  executionsSubquery,
  prepareFilter,
  type TestPerformanceFilterInput,
  TestPerformanceFilterSchema,
} from "./filters";

// --- Stats ---

export interface TestPerformanceStats {
  totalExecutions: number;
  failExecutions: number;
  uniqueFailingTests: number;
  avgDuration: number;
  medianDuration: number;
  p95Duration: number;
  maxDuration: number;
  stdDevDuration: number;
  coefficientOfVariation: number;
  failureRate: number;
}

export const getTestPerfStats = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TestPerformanceFilterSchema)
  .handler(
    async ({
      data,
      context: {
        clickhouse: { query },
      },
    }) => {
      const { whereClause, scopeWhere, params } = prepareFilter(data);
      const inner = executionsSubquery(whereClause);

      const sql = `
      SELECT
        count(*) as total_executions,
        countIf(test_result = 'fail') as fail_executions,
        uniqExactIf(test_full_name, test_result = 'fail') as unique_failing_tests,
        avg(test_duration) as avg_duration,
        quantile(0.5)(test_duration) as median_duration,
        quantile(0.95)(test_duration) as p95_duration,
        max(test_duration) as max_duration,
        stddevPop(test_duration) as stddev_duration,
        round(stddevPop(test_duration) * 100.0 / nullIf(avg(test_duration), 0), 1) as coefficient_of_variation,
        round(
          countIf(test_result = 'fail') * 100.0
          / nullIf(countIf(test_result = 'fail') + countIf(test_result = 'pass'), 0),
          1
        ) as failure_rate
      FROM (
        SELECT test_full_name, test_result, test_duration
        FROM (${inner})
        ${scopeWhere}
      )
    `;

      const result = await query<{
        total_executions: string;
        fail_executions: string;
        unique_failing_tests: string;
        avg_duration: string;
        median_duration: string;
        p95_duration: string;
        max_duration: string;
        stddev_duration: string;
        coefficient_of_variation: string;
        failure_rate: string;
      }>(sql, params);

      if (result.length === 0) {
        return {
          totalExecutions: 0,
          failExecutions: 0,
          uniqueFailingTests: 0,
          avgDuration: 0,
          medianDuration: 0,
          p95Duration: 0,
          maxDuration: 0,
          stdDevDuration: 0,
          coefficientOfVariation: 0,
          failureRate: 0,
        } satisfies TestPerformanceStats;
      }

      return {
        totalExecutions: Number(result[0].total_executions),
        failExecutions: Number(result[0].fail_executions),
        uniqueFailingTests: Number(result[0].unique_failing_tests),
        avgDuration: Number(result[0].avg_duration),
        medianDuration: Number(result[0].median_duration),
        p95Duration: Number(result[0].p95_duration),
        maxDuration: Number(result[0].max_duration),
        stdDevDuration: Number(result[0].stddev_duration),
        coefficientOfVariation: Number(result[0].coefficient_of_variation) || 0,
        failureRate: Number(result[0].failure_rate) || 0,
      } satisfies TestPerformanceStats;
    },
  );

// --- Scatter ---

export interface ScatterPoint {
  testName: string;
  duration: number;
  result: string;
  timestamp: string;
  branch: string;
  repo: string;
  traceId: string;
  commitSha: string;
}

export const getTestPerfScatter = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TestPerformanceFilterSchema)
  .handler(
    async ({
      data,
      context: {
        clickhouse: { query },
      },
    }) => {
      const { whereClause, scopeWhere, params, aggregateByRun } =
        prepareFilter(data);
      const inner = executionsSubquery(whereClause, {
        includeMetadata: true,
        includeTimestamp: true,
      });

      let sql: string;

      if (aggregateByRun) {
        // Package level: one dot per CI run, sum leaf-test durations
        sql = `
        SELECT
          {pkg:String} as test_full_name,
          sum(test_duration) as test_duration,
          if(countIf(test_result = 'fail') > 0, 'fail', 'pass') as test_result,
          max(timestamp) as timestamp,
          any(branch) as branch,
          repo,
          any(trace_id) as trace_id,
          any(head_sha) as head_sha
        FROM (
          SELECT test_full_name, test_duration, test_result, timestamp, branch, repo, trace_id, head_sha, run_id
          FROM (${inner})
          ${scopeWhere}
        )
        GROUP BY repo, run_id
        ORDER BY timestamp ASC
        LIMIT 1000
      `;
      } else {
        sql = `
        SELECT test_full_name, test_duration, test_result, timestamp, branch, repo, trace_id, head_sha
        FROM (${inner})
        ${scopeWhere}
        ORDER BY timestamp ASC
        LIMIT 1000
      `;
      }

      const result = await query<{
        test_full_name: string;
        test_duration: string;
        test_result: string;
        timestamp: string;
        branch: string;
        repo: string;
        trace_id: string;
        head_sha: string;
      }>(sql, params);

      return result.map((row) => ({
        testName: row.test_full_name,
        duration: Number(row.test_duration),
        result: row.test_result,
        timestamp: row.timestamp,
        branch: row.branch,
        repo: row.repo,
        traceId: row.trace_id,
        commitSha: row.head_sha,
      })) satisfies ScatterPoint[];
    },
  );

// --- Trend ---

export interface TestPerfTrendPoint {
  date: string;
  avgDuration: number;
  p50Duration: number;
  p95Duration: number;
}

export interface TestPerfStatsTrendPoint {
  date: string;
  totalExecutions: number;
  failExecutions: number;
  uniqueFailingTests: number;
  avgDuration: number;
  medianDuration: number;
  p95Duration: number;
  maxDuration: number;
  coefficientOfVariation: number;
  failureRate: number;
}

export const getTestPerfTrend = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TestPerformanceFilterSchema)
  .handler(
    async ({
      data,
      context: {
        clickhouse: { query },
      },
    }) => {
      const { whereClause, scopeWhere, params } = prepareFilter(data);
      const inner = executionsSubquery(whereClause, {
        includeResult: false,
        includeTimestamp: true,
      });

      const sql = `
      SELECT
        toDate(timestamp) as date,
        avg(test_duration) as avg_duration,
        quantile(0.5)(test_duration) as p50_duration,
        quantile(0.95)(test_duration) as p95_duration
      FROM (
        SELECT test_full_name, test_duration, timestamp
        FROM (${inner})
        ${scopeWhere}
      )
      GROUP BY date
      ORDER BY date ASC WITH FILL FROM toDate({fromTime:String}) TO toDate({toTime:String}) + 1
    `;

      const result = await query<{
        date: string;
        avg_duration: string;
        p50_duration: string;
        p95_duration: string;
      }>(sql, params);

      return result.map((row) => ({
        date: row.date,
        avgDuration: Number(row.avg_duration),
        p50Duration: Number(row.p50_duration),
        p95Duration: Number(row.p95_duration),
      })) satisfies TestPerfTrendPoint[];
    },
  );

export const getTestPerfStatsTrend = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TestPerformanceFilterSchema)
  .handler(
    async ({
      data,
      context: {
        clickhouse: { query },
      },
    }) => {
      const { whereClause, scopeWhere, params, fromISO, toISO } =
        prepareFilter(data);
      const inner = executionsSubquery(whereClause, {
        includeTimestamp: true,
      });

      const sql = `
      SELECT
        toDate(timestamp) as date,
        count(*) as total_executions,
        countIf(test_result = 'fail') as fail_executions,
        uniqExactIf(test_full_name, test_result = 'fail') as unique_failing_tests,
        avg(test_duration) as avg_duration,
        quantile(0.5)(test_duration) as median_duration,
        quantile(0.95)(test_duration) as p95_duration,
        max(test_duration) as max_duration,
        round(stddevPop(test_duration) * 100.0 / nullIf(avg(test_duration), 0), 1) as coefficient_of_variation,
        round(
          countIf(test_result = 'fail') * 100.0
          / nullIf(countIf(test_result = 'fail') + countIf(test_result = 'pass'), 0),
          1
        ) as failure_rate
      FROM (
        SELECT test_full_name, test_result, test_duration, timestamp
        FROM (${inner})
        ${scopeWhere}
      )
      GROUP BY date
      ORDER BY date ASC WITH FILL FROM toDate({fromTime:String}) TO toDate({toTime:String}) + 1
    `;

      const result = await query<{
        date: string;
        total_executions: string;
        fail_executions: string;
        unique_failing_tests: string;
        avg_duration: string;
        median_duration: string;
        p95_duration: string;
        max_duration: string;
        coefficient_of_variation: string;
        failure_rate: string;
      }>(sql, {
        ...params,
        fromTime: fromISO,
        toTime: toISO,
      });

      return result.map((row) => ({
        date: row.date,
        totalExecutions: Number(row.total_executions),
        failExecutions: Number(row.fail_executions),
        uniqueFailingTests: Number(row.unique_failing_tests),
        avgDuration: Number(row.avg_duration),
        medianDuration: Number(row.median_duration),
        p95Duration: Number(row.p95_duration),
        maxDuration: Number(row.max_duration),
        coefficientOfVariation: Number(row.coefficient_of_variation) || 0,
        failureRate: Number(row.failure_rate) || 0,
      })) satisfies TestPerfStatsTrendPoint[];
    },
  );

// --- Failures ---

export interface TestFailure {
  testName: string;
  duration: number;
  timestamp: string;
  branch: string;
  commitSha: string;
  traceId: string;
  repo: string;
}

export const getTestPerfFailures = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TestPerformanceFilterSchema)
  .handler(
    async ({
      data,
      context: {
        clickhouse: { query },
      },
    }) => {
      const { whereClause, scopeConditions, params } = prepareFilter(data);
      const inner = executionsSubquery(whereClause, {
        includeMetadata: true,
        includeTimestamp: true,
      });
      const scopeFilters = [...scopeConditions, "test_result = 'fail'"];
      const failuresWhere = `WHERE ${scopeFilters.join("\n\t\t\t\t\tAND ")}`;

      const sql = `
      SELECT test_full_name, test_duration, timestamp, branch, head_sha, trace_id, repo
      FROM (${inner})
      ${failuresWhere}
      ORDER BY timestamp DESC
      LIMIT 50
    `;

      const result = await query<{
        test_full_name: string;
        test_duration: string;
        timestamp: string;
        branch: string;
        head_sha: string;
        trace_id: string;
        repo: string;
      }>(sql, params);

      return result.map((row) => ({
        testName: row.test_full_name,
        duration: Number(row.test_duration),
        timestamp: row.timestamp,
        branch: row.branch,
        commitSha: row.head_sha,
        traceId: row.trace_id,
        repo: row.repo,
      })) satisfies TestFailure[];
    },
  );

// Query option factories for stats, scatter, trend, failures

export const testPerfStatsOptions = (input: TestPerformanceFilterInput) =>
  queryOptions({
    queryKey: ["testPerf", "stats", input],
    queryFn: () => getTestPerfStats({ data: input }),
  });

export const testPerfScatterOptions = (input: TestPerformanceFilterInput) =>
  queryOptions({
    queryKey: ["testPerf", "scatter", input],
    queryFn: () => getTestPerfScatter({ data: input }),
  });

export const testPerfTrendOptions = (input: TestPerformanceFilterInput) =>
  queryOptions({
    queryKey: ["testPerf", "trend", input],
    queryFn: () => getTestPerfTrend({ data: input }),
  });

export const testPerfStatsTrendOptions = (input: TestPerformanceFilterInput) =>
  queryOptions({
    queryKey: ["testPerf", "statsTrend", input],
    queryFn: () => getTestPerfStatsTrend({ data: input }),
  });

export const testPerfFailuresOptions = (input: TestPerformanceFilterInput) =>
  queryOptions({
    queryKey: ["testPerf", "failures", input],
    queryFn: () => getTestPerfFailures({ data: input }),
  });
