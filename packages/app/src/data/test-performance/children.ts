import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import {
  resolveTimeRange,
  type TimeRange,
  TimeRangeSchema,
} from "@/lib/time-range";
import { testFullNameExpr } from "../sql-helpers";

// Filter options (repos + branches that have test data)
export interface TestPerfFilterOptions {
  repos: string[];
  branches: string[];
}

const TestPerfFilterOptionsInputSchema = z.object({
  timeRange: TimeRangeSchema,
});

export const getTestPerfFilterOptions = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TestPerfFilterOptionsInputSchema)
  .handler(async ({ data, context: { clickhouse } }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);
    const [repos, branches] = await Promise.all([
      clickhouse.query<{ repo: string }>(
        `SELECT DISTINCT ResourceAttributes['vcs.repository.name'] as repo
      FROM traces
      WHERE Timestamp >= {from:String} AND Timestamp <= {to:String}
        AND ResourceAttributes['vcs.repository.name'] != ''
        AND SpanAttributes['everr.test.name'] != ''
      ORDER BY repo
      LIMIT 100`,
        { from: fromISO, to: toISO },
      ),
      clickhouse.query<{ branch: string }>(
        `SELECT DISTINCT ResourceAttributes['vcs.ref.head.name'] as branch
      FROM traces
      WHERE Timestamp >= {from:String} AND Timestamp <= {to:String}
        AND ResourceAttributes['vcs.ref.head.name'] != ''
        AND SpanAttributes['everr.test.name'] != ''
      ORDER BY branch
      LIMIT 100`,
        { from: fromISO, to: toISO },
      ),
    ]);

    return {
      repos: repos.map((r) => r.repo),
      branches: branches.map((r) => r.branch),
    } satisfies TestPerfFilterOptions;
  });

const testPerfFilterOptionsBase = (input: { timeRange: TimeRange }) => ({
  queryKey: ["testPerf", "filterOptions", input.timeRange] as const,
  queryFn: () => getTestPerfFilterOptions({ data: input }),
});

const createTestPerfFieldFilter =
  (field: keyof TestPerfFilterOptions) =>
  (input: { timeRange: TimeRange }) => ({
    ...testPerfFilterOptionsBase(input),
    select: (data: TestPerfFilterOptions) => data[field],
  });

export const testPerfRepoFilterOptions = createTestPerfFieldFilter("repos");
export const testPerfBranchFilterOptions =
  createTestPerfFieldFilter("branches");

// --- Children (hierarchy browser) ---

export interface TestPerfChild {
  name: string;
  isSuite: boolean;
  executions: number;
  avgDuration: number;
  p95Duration: number;
  failureRate: number;
}

const TestPerfChildrenInputSchema = z.object({
  timeRange: TimeRangeSchema,
  repos: z.array(z.string()).optional(),
  pkg: z.string().optional(),
  branches: z.array(z.string()).optional(),
  path: z.string().optional(),
});

export type TestPerfChildrenInput = z.infer<typeof TestPerfChildrenInputSchema>;

export const getTestPerfChildren = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(TestPerfChildrenInputSchema)
  .handler(async ({ data, context: { clickhouse } }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);

    const baseConditions = [
      "Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}",
      "SpanAttributes['everr.test.name'] != ''",
      "SpanAttributes['everr.test.result'] IN ('pass', 'fail')",
    ];
    const params: Record<string, unknown> = {
      fromTime: fromISO,
      toTime: toISO,
    };

    if (data.repos?.length) {
      baseConditions.push(
        "ResourceAttributes['vcs.repository.name'] IN {repos:Array(String)}",
      );
      params.repos = data.repos;
    }
    if (data.branches?.length) {
      baseConditions.push(
        "ResourceAttributes['vcs.ref.head.name'] IN {branches:Array(String)}",
      );
      params.branches = data.branches;
    }

    const isRoot = !data.pkg;

    if (isRoot) {
      const rootConditions = [...baseConditions];
      rootConditions.push("SpanAttributes['everr.test.package'] != ''");
      const rootWhere = rootConditions.join("\n          AND ");

      const sql = `
        WITH executions AS (
          SELECT
            SpanAttributes['everr.test.package'] as pkg_name,
            SpanAttributes['everr.test.name'] as name,
            SpanAttributes['everr.test.parent_test'] as parent_test,
            ${testFullNameExpr()},
            if(
              SpanAttributes['everr.test.parent_test'] != '',
              concat(
                replaceAll(SpanAttributes['everr.test.parent_test'], ' > ', '/'),
                '/',
                SpanAttributes['everr.test.name']
              ),
              SpanAttributes['everr.test.name']
            ) as normalized_full_name,
            ResourceAttributes['cicd.pipeline.run.id'] as run_id,
            ResourceAttributes['vcs.ref.head.revision'] as head_sha,
            anyLast(SpanAttributes['everr.test.result']) as test_result,
            anyLast(toFloat64OrZero(SpanAttributes['everr.test.duration_seconds'])) as test_duration
          FROM traces
          WHERE ${rootWhere}
          GROUP BY pkg_name, name, parent_test, test_full_name, normalized_full_name, run_id, head_sha
        ),
        direct_children AS (
          SELECT DISTINCT
            pkg_name,
            name as child_name,
            normalized_full_name as child_full_name
          FROM executions
          WHERE parent_test = ''
        ),
        child_rows AS (
          SELECT
            c.pkg_name,
            c.child_name,
            e.run_id,
            e.head_sha,
            e.test_result,
            e.test_duration
          FROM direct_children c
          INNER JOIN executions e
            ON e.pkg_name = c.pkg_name
            AND (
              e.normalized_full_name = c.child_full_name
              OR startsWith(e.normalized_full_name, concat(c.child_full_name, '/'))
            )
        ),
        child_run_rollup AS (
          SELECT
            pkg_name,
            child_name,
            run_id,
            head_sha,
            sum(test_duration) as child_run_duration,
            if(countIf(test_result = 'fail') > 0, 1, 0) as child_run_has_fail
          FROM child_rows
          GROUP BY pkg_name, child_name, run_id, head_sha
        ),
        package_run_rollup AS (
          SELECT
            pkg_name,
            run_id,
            head_sha,
            sum(child_run_duration) as run_duration,
            if(countIf(child_run_has_fail = 1) > 0, 1, 0) as run_has_fail
          FROM child_run_rollup
          GROUP BY pkg_name, run_id, head_sha
        )
        SELECT
          pkg_name as name,
          1 as is_suite,
          countDistinct(tuple(run_id, head_sha)) as executions,
          avg(run_duration) as avg_duration,
          quantile(0.95)(run_duration) as p95_duration,
          round(countIf(run_has_fail = 1) * 100.0 / nullIf(count(), 0), 1) as failure_rate
        FROM package_run_rollup
        GROUP BY pkg_name
        ORDER BY pkg_name
      `;

      const result = await clickhouse.query<{
        name: string;
        is_suite: number;
        executions: string;
        avg_duration: string;
        p95_duration: string;
        failure_rate: string;
      }>(sql, params);

      return result.map((row) => ({
        name: row.name,
        isSuite: row.is_suite === 1,
        executions: Number(row.executions),
        avgDuration: Number(row.avg_duration),
        p95Duration: Number(row.p95_duration),
        failureRate: Number(row.failure_rate) || 0,
      })) satisfies TestPerfChild[];
    }

    // Package or deeper level: return direct children with suite flag in one query
    const childConditions = [...baseConditions];
    childConditions.push("SpanAttributes['everr.test.package'] = {pkg:String}");
    params.pkg = data.pkg;

    const parentTest = data.path ?? "";
    params.parentTest = parentTest;

    childConditions.push(
      "SpanAttributes['everr.test.parent_test'] = {parentTest:String}",
    );

    const childWhere = childConditions.join("\n          AND ");

    const suiteConditions = [...baseConditions];
    suiteConditions.push("SpanAttributes['everr.test.package'] = {pkg:String}");
    suiteConditions.push("SpanAttributes['everr.test.parent_test'] != ''");
    const suiteWhere = suiteConditions.join("\n          AND ");

    const sql = `
      SELECT
        c.name,
        if(countIf(s.name != '') > 0, 1, 0) as is_suite,
        countDistinct(tuple(c.run_id, c.head_sha)) as executions,
        avg(c.test_duration) as avg_duration,
        quantile(0.95)(c.test_duration) as p95_duration,
        round(countIf(c.test_result = 'fail') * 100.0 / nullIf(count(), 0), 1) as failure_rate
      FROM (
        SELECT
          SpanAttributes['everr.test.name'] as name,
          ${testFullNameExpr()},
          ResourceAttributes['cicd.pipeline.run.id'] as run_id,
          ResourceAttributes['vcs.ref.head.revision'] as head_sha,
          anyLast(SpanAttributes['everr.test.result']) as test_result,
          anyLast(toFloat64OrZero(SpanAttributes['everr.test.duration_seconds'])) as test_duration
        FROM traces
        WHERE ${childWhere}
        GROUP BY name, test_full_name, run_id, head_sha
      ) c
      LEFT JOIN (
        SELECT DISTINCT SpanAttributes['everr.test.parent_test'] as name
        FROM traces
        WHERE ${suiteWhere}
      ) s USING (name)
      GROUP BY c.name
      ORDER BY c.name
    `;

    const result = await clickhouse.query<{
      name: string;
      is_suite: number;
      executions: string;
      avg_duration: string;
      p95_duration: string;
      failure_rate: string;
    }>(sql, params);

    return result.map((row) => ({
      name: row.name,
      isSuite: row.is_suite === 1,
      executions: Number(row.executions),
      avgDuration: Number(row.avg_duration),
      p95Duration: Number(row.p95_duration),
      failureRate: Number(row.failure_rate) || 0,
    })) satisfies TestPerfChild[];
  });

export const testPerfChildrenOptions = (input: TestPerfChildrenInput) =>
  queryOptions({
    queryKey: ["testPerf", "children", input],
    queryFn: () => getTestPerfChildren({ data: input }),
  });
