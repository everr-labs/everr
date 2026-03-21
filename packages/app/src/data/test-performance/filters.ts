import { z } from "zod";
import { resolveTimeRange, TimeRangeSchema } from "@/lib/time-range";
import { leafTestFilter, testFullNameExpr } from "../sql-helpers";

// Filter input for test performance
export const TestPerformanceFilterSchema = z.object({
  timeRange: TimeRangeSchema,
  repo: z.string().optional(),
  pkg: z.string().optional(),
  testName: z.string().optional(),
  branch: z.string().optional(),
  branches: z.array(z.string()).nullable().optional(),
  path: z.string().optional(),
});
export type TestPerformanceFilterInput = z.infer<
  typeof TestPerformanceFilterSchema
>;

interface BuildFilterResult {
  conditions: string[];
  params: Record<string, unknown>;
  /** Scope conditions to apply on the OUTER query using the test_full_name alias */
  scopeConditions: string[];
  /** When true, metrics should aggregate all leaf tests per run (package-level view) */
  aggregateByRun: boolean;
}

export function buildFilterConditions(
  fromISO: string,
  toISO: string,
  data: TestPerformanceFilterInput,
  options?: {
    includeSkipResults?: boolean;
  },
): BuildFilterResult {
  const includeSkipResults = options?.includeSkipResults ?? false;
  const conditions: string[] = [
    "Timestamp >= {fromTime:String} AND Timestamp <= {toTime:String}",
    "SpanAttributes['everr.test.name'] != ''",
    includeSkipResults
      ? "SpanAttributes['everr.test.result'] IN ('pass', 'fail', 'skip')"
      : "SpanAttributes['everr.test.result'] IN ('pass', 'fail')",
  ];
  const params: Record<string, unknown> = {
    fromTime: fromISO,
    toTime: toISO,
  };
  const scopeConditions: string[] = [];

  if (data.repo) {
    conditions.push(
      "ResourceAttributes['vcs.repository.name'] = {repo:String}",
    );
    params.repo = data.repo;
  }
  if (data.pkg) {
    conditions.push("SpanAttributes['everr.test.package'] = {pkg:String}");
    params.pkg = data.pkg;
  }
  if (data.testName) {
    conditions.push(
      "SpanAttributes['everr.test.name'] ILIKE {testName:String}",
    );
    params.testName = `%${data.testName}%`;
  }
  if (data.branch) {
    conditions.push(
      "ResourceAttributes['vcs.ref.head.name'] = {branch:String}",
    );
    params.branch = data.branch;
  }
  if (data.branches != null) {
    conditions.push(
      "ResourceAttributes['vcs.ref.head.name'] IN ({branches:Array(String)})",
    );
    params.branches = data.branches;
  }

  if (data.path) {
    // name already contains the full test path for Vitest, Rust, and Go tests
    conditions.push("SpanAttributes['everr.test.name'] = {exactPath:String}");
    params.exactPath = data.path;
  } else if (data.pkg) {
    // Package level: show direct children only (describe blocks / top-level tests)
    conditions.push("SpanAttributes['everr.test.parent_test'] = ''");
  } else {
    // Root level: show only leaf tests (exclude suites)
    const leafScopeConditions: string[] = [];
    if (data.repo) {
      leafScopeConditions.push(
        "ResourceAttributes['vcs.repository.name'] = {repo:String}",
      );
    }
    if (data.branch) {
      leafScopeConditions.push(
        "ResourceAttributes['vcs.ref.head.name'] = {branch:String}",
      );
    }
    if (data.branches != null) {
      leafScopeConditions.push(
        "ResourceAttributes['vcs.ref.head.name'] IN ({branches:Array(String)})",
      );
    }
    scopeConditions.push(
      leafTestFilter({
        leftExpr: "test_full_name",
        extraConditions: leafScopeConditions,
      }),
    );
  }

  // Package level without a specific path: aggregate per run
  const aggregateByRun = !!data.pkg && !data.path;

  return { conditions, params, scopeConditions, aggregateByRun };
}

/**
 * Resolves time range, builds filter conditions, and joins them into SQL fragments.
 * Shared boilerplate for stats, scatter, trend, and failures handlers.
 */
export function prepareFilter(data: TestPerformanceFilterInput) {
  const { fromISO, toISO } = resolveTimeRange(data.timeRange);
  const filter = buildFilterConditions(fromISO, toISO, data);
  const whereClause = filter.conditions.join("\n\t\t\t\t\tAND ");
  const scopeWhere =
    filter.scopeConditions.length > 0
      ? `WHERE ${filter.scopeConditions.join("\n\t\t\t\t\tAND ")}`
      : "";
  return { ...filter, whereClause, scopeWhere, fromISO, toISO };
}

/**
 * Builds the inner deduplication subquery that collapses multiple spans for the
 * same (test_full_name, run_id, head_sha) into a single execution row.
 *
 * @param whereClause - SQL WHERE conditions
 * @param opts.includeResult - include test_result column (default true)
 * @param opts.includeTimestamp - include max(Timestamp) as timestamp
 * @param opts.includeMetadata - include branch, repo, trace_id columns
 */
export function executionsSubquery(
  whereClause: string,
  opts: {
    includeResult?: boolean;
    includeTimestamp?: boolean;
    includeMetadata?: boolean;
  } = {},
): string {
  const {
    includeResult = true,
    includeTimestamp = false,
    includeMetadata = false,
  } = opts;

  const selects = [
    testFullNameExpr(),
    "ResourceAttributes['cicd.pipeline.run.id'] as run_id",
    "ResourceAttributes['vcs.ref.head.revision'] as head_sha",
  ];
  const groupBy = ["test_full_name", "run_id", "head_sha"];

  if (includeMetadata) {
    selects.push(
      "ResourceAttributes['vcs.ref.head.name'] as branch",
      "ResourceAttributes['vcs.repository.name'] as repo",
      "TraceId as trace_id",
    );
    groupBy.push("branch", "repo", "trace_id");
  }

  if (includeResult) {
    selects.push("anyLast(SpanAttributes['everr.test.result']) as test_result");
  }
  selects.push(
    "anyLast(toFloat64OrZero(SpanAttributes['everr.test.duration_seconds'])) as test_duration",
  );
  if (includeTimestamp) {
    selects.push("max(Timestamp) as timestamp");
  }

  return `SELECT
            ${selects.join(",\n            ")}
          FROM traces
          WHERE ${whereClause}
          GROUP BY ${groupBy.join(", ")}`;
}
