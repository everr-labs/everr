import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query } from "@/lib/clickhouse";
import { resolveTimeRange, TimeRangeSchema } from "@/lib/time-range";
import { testFullNameExpr } from "./sql-helpers";

// Filter input for test performance
export const TestPerformanceFilterSchema = z.object({
  timeRange: TimeRangeSchema,
  repo: z.string().optional(),
  pkg: z.string().optional(),
  testName: z.string().optional(),
  branch: z.string().optional(),
});
export type TestPerformanceFilterInput = z.infer<
  typeof TestPerformanceFilterSchema
>;

// Filter options (repos + branches that have test data)
export interface TestPerfFilterOptions {
  repos: string[];
  branches: string[];
}

export function buildFilterConditions(
  fromISO: string,
  toISO: string,
  data: TestPerformanceFilterInput,
): { conditions: string[]; params: Record<string, unknown> } {
  const conditions: string[] = [
    "Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}",
    "SpanAttributes['citric.test.name'] != ''",
    "SpanAttributes['citric.test.result'] IN ('pass', 'fail')",
  ];
  const params: Record<string, unknown> = {
    fromTime: fromISO,
    toTime: toISO,
  };

  if (data.repo) {
    conditions.push(
      "ResourceAttributes['vcs.repository.name'] = {repo:String}",
    );
    params.repo = data.repo;
  }
  if (data.pkg) {
    conditions.push("SpanAttributes['citric.test.package'] = {pkg:String}");
    params.pkg = data.pkg;
  }
  if (data.testName) {
    conditions.push(`${testFullNameExpr(null)} ILIKE {testName:String}`);
    params.testName = `%${data.testName}%`;
  }
  if (data.branch) {
    conditions.push(
      "ResourceAttributes['vcs.ref.head.name'] = {branch:String}",
    );
    params.branch = data.branch;
  }

  return { conditions, params };
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

// Server function: packages filtered by time range and optional repo
const TestPerfPackagesInputSchema = z.object({
  timeRange: TimeRangeSchema,
  repo: z.string().optional(),
});

export const getTestPerfPackages = createServerFn({
  method: "GET",
})
  .inputValidator(TestPerfPackagesInputSchema)
  .handler(async ({ data }) => {
    const { fromISO, toISO } = resolveTimeRange(data.timeRange);
    const conditions: string[] = [
      "Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}",
      "SpanAttributes['citric.test.name'] != ''",
      "SpanAttributes['citric.test.package'] != ''",
    ];
    const params: Record<string, unknown> = {
      fromTime: fromISO,
      toTime: toISO,
    };

    if (data.repo) {
      conditions.push(
        "ResourceAttributes['vcs.repository.name'] = {repo:String}",
      );
      params.repo = data.repo;
    }

    const whereClause = conditions.join("\n\t\t\t\tAND ");

    const result = await query<{ pkg: string }>(
      `SELECT DISTINCT SpanAttributes['citric.test.package'] as pkg
			FROM otel_traces
			WHERE ${whereClause}
			ORDER BY pkg
			LIMIT 200`,
      params,
    );

    return result.map((r) => r.pkg);
  });

// Query option factories
export const testPerfFilterOptionsOptions = () =>
  queryOptions({
    queryKey: ["testPerf", "filterOptions"],
    queryFn: () => getTestPerfFilterOptions(),
    staleTime: 5 * 60_000,
  });

export const testPerfPackagesOptions = (
  input: z.infer<typeof TestPerfPackagesInputSchema>,
) =>
  queryOptions({
    queryKey: ["testPerf", "packages", input],
    queryFn: () => getTestPerfPackages({ data: input }),
    staleTime: 60_000,
  });
