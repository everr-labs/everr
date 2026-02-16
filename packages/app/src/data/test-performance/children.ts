import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query } from "@/lib/clickhouse";
import { resolveTimeRange, TimeRangeSchema } from "@/lib/time-range";
import { leafTestFilter, testFullNameExpr } from "../sql-helpers";

// Filter options (repos + branches that have test data)
export interface TestPerfFilterOptions {
  repos: string[];
  branches: string[];
}

// Server function: filter options (repos + branches from last 90 days)
export const getTestPerfFilterOptions = createServerFn({
  method: "GET",
}).handler(async () => {
  const [repos, branches] = await Promise.all([
    query<{ repo: string }>(
      `SELECT DISTINCT ResourceAttributes['vcs.repository.name'] as repo
      FROM otel_traces
      WHERE Timestamp >= now() - INTERVAL 90 DAY
        AND ResourceAttributes['vcs.repository.name'] != ''
        AND SpanAttributes['citric.test.name'] != ''
      ORDER BY repo
      LIMIT 100`,
    ),
    query<{ branch: string }>(
      `SELECT DISTINCT ResourceAttributes['vcs.ref.head.name'] as branch
      FROM otel_traces
      WHERE Timestamp >= now() - INTERVAL 90 DAY
        AND ResourceAttributes['vcs.ref.head.name'] != ''
        AND SpanAttributes['citric.test.name'] != ''
      ORDER BY branch
      LIMIT 100`,
    ),
  ]);

  return {
    repos: repos.map((r) => r.repo),
    branches: branches.map((r) => r.branch),
  } satisfies TestPerfFilterOptions;
});

export const testPerfFilterOptionsOptions = () =>
  queryOptions({
    queryKey: ["testPerf", "filterOptions"],
    queryFn: () => getTestPerfFilterOptions(),
    staleTime: 5 * 60_000,
  });

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
  repo: z.string().optional(),
  pkg: z.string().optional(),
  branch: z.string().optional(),
  path: z.string().optional(),
});

export type TestPerfChildrenInput = z.infer<typeof TestPerfChildrenInputSchema>;

export const getTestPerfChildren = createServerFn({
  method: "GET",
})
  .inputValidator(TestPerfChildrenInputSchema)
  .handler(async ({ data }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);

    const baseConditions = [
      "Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}",
      "SpanAttributes['citric.test.name'] != ''",
      "SpanAttributes['citric.test.result'] IN ('pass', 'fail')",
    ];
    const params: Record<string, unknown> = {
      fromTime: fromISO,
      toTime: toISO,
    };

    if (data.repo) {
      baseConditions.push(
        "ResourceAttributes['vcs.repository.name'] = {repo:String}",
      );
      params.repo = data.repo;
    }
    if (data.branch) {
      baseConditions.push(
        "ResourceAttributes['vcs.ref.head.name'] = {branch:String}",
      );
      params.branch = data.branch;
    }

    const isRoot = !data.pkg;

    if (isRoot) {
      const conditions = [...baseConditions];
      // Root level: return packages with aggregate leaf-only metrics
      conditions.push("SpanAttributes['citric.test.package'] != ''");
      conditions.push(leafTestFilter());
      const whereClause = conditions.join("\n          AND ");

      const sql = `
        SELECT
          name,
          1 as is_suite,
          count(*) as executions,
          avg(test_duration) as avg_duration,
          quantile(0.95)(test_duration) as p95_duration,
          round(countIf(test_result = 'fail') * 100.0 / nullIf(count(), 0), 1) as failure_rate
        FROM (
          SELECT
            SpanAttributes['citric.test.package'] as name,
            ${testFullNameExpr()},
            ResourceAttributes['cicd.pipeline.run.id'] as run_id,
            ResourceAttributes['vcs.ref.head.revision'] as head_sha,
            anyLast(SpanAttributes['citric.test.result']) as test_result,
            anyLast(toFloat64OrZero(SpanAttributes['citric.test.duration_seconds'])) as test_duration
          FROM otel_traces
          WHERE ${whereClause}
          GROUP BY name, test_full_name, run_id, head_sha
        )
        GROUP BY name
        ORDER BY name
      `;

      const result = await query<{
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
    childConditions.push(
      "SpanAttributes['citric.test.package'] = {pkg:String}",
    );
    params.pkg = data.pkg;

    const parentTest = data.path ?? "";
    childConditions.push(
      "SpanAttributes['citric.test.parent_test'] = {parentTest:String}",
    );
    params.parentTest = parentTest;

    const childWhere = childConditions.join("\n          AND ");

    const suiteConditions = [...baseConditions];
    suiteConditions.push(
      "SpanAttributes['citric.test.package'] = {pkg:String}",
    );
    suiteConditions.push("SpanAttributes['citric.test.parent_test'] != ''");
    const suiteWhere = suiteConditions.join("\n          AND ");

    const sql = `
      SELECT
        c.name,
        if(countIf(s.name != '') > 0, 1, 0) as is_suite,
        count(*) as executions,
        avg(c.test_duration) as avg_duration,
        quantile(0.95)(c.test_duration) as p95_duration,
        round(countIf(c.test_result = 'fail') * 100.0 / nullIf(count(), 0), 1) as failure_rate
      FROM (
        SELECT
          SpanAttributes['citric.test.name'] as name,
          ${testFullNameExpr()},
          ResourceAttributes['cicd.pipeline.run.id'] as run_id,
          ResourceAttributes['vcs.ref.head.revision'] as head_sha,
          anyLast(SpanAttributes['citric.test.result']) as test_result,
          anyLast(toFloat64OrZero(SpanAttributes['citric.test.duration_seconds'])) as test_duration
        FROM otel_traces
        WHERE ${childWhere}
        GROUP BY name, test_full_name, run_id, head_sha
      ) c
      LEFT JOIN (
        SELECT DISTINCT SpanAttributes['citric.test.parent_test'] as name
        FROM otel_traces
        WHERE ${suiteWhere}
      ) s USING (name)
      GROUP BY c.name
      ORDER BY c.name
    `;

    const result = await query<{
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
    staleTime: 60_000,
  });
