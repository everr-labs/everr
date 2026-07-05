interface RunSummarySubqueryOptions {
  whereClause: string;
  groupByExpr: string;
  groupByAlias: string;
  includeRunAttempt?: boolean;
  includeDuration?: boolean;
  includeSender?: boolean;
  includeHeadSha?: boolean;
  includeJobCount?: boolean;
}

export const CONCLUSION_EXPR =
  "coalesce(nullIf(argMaxIf(ResourceAttributes['cicd.pipeline.result'], Timestamp, ResourceAttributes['cicd.pipeline.result'] != ''), ''), argMaxIf(ResourceAttributes['cicd.pipeline.task.run.result'], Timestamp, ResourceAttributes['cicd.pipeline.task.run.result'] != ''))";

/** `ResourceAttributes['key']` accessor. */
export function resourceAttribute(key: string): string {
  return `ResourceAttributes['${key}']`;
}

/**
 * Presence + non-empty check for a resource attribute. The `mapContains` term
 * lets the `idx_res_attr_key` bloom skip index prune granules that lack the key
 * before the value is read.
 */
export function nonEmptyResourceAttribute(key: string): string {
  return `mapContains(ResourceAttributes, '${key}') AND ${resourceAttribute(key)} != ''`;
}

/** Equality on a resource attribute, key-index-prunable via `mapContains`. */
export function resourceAttributeEquals(key: string, param: string): string {
  return `mapContains(ResourceAttributes, '${key}') AND ${resourceAttribute(key)} = {${param}:String}`;
}

/**
 * Builds a run-level deduplication subquery over traces.
 * Collapses multiple spans into one row per run grouping key.
 */
export function runSummarySubquery({
  whereClause,
  groupByExpr,
  groupByAlias,
  includeRunAttempt = false,
  includeDuration = false,
  includeSender = false,
  includeHeadSha = false,
  includeJobCount = false,
}: RunSummarySubqueryOptions): string {
  const selects: string[] = [
    `${groupByExpr} as ${groupByAlias}`,
    "anyLast(ResourceAttributes['cicd.pipeline.run.id']) as run_id",
    "anyLast(ResourceAttributes['cicd.pipeline.name']) as workflowName",
    "anyLast(ResourceAttributes['vcs.repository.name']) as repo",
    "anyLast(ResourceAttributes['vcs.ref.head.name']) as branch",
    `${CONCLUSION_EXPR} as conclusion`,
    "max(Timestamp) as timestamp",
  ];

  if (includeRunAttempt) {
    selects.push(
      "anyLast(toUInt32OrZero(ResourceAttributes['everr.github.workflow_job.run_attempt'])) as run_attempt",
    );
  }
  if (includeDuration) {
    selects.push(`max(Duration) / 1000000 as duration`);
  }
  if (includeSender) {
    selects.push("max(ResourceAttributes['cicd.pipeline.task.run.sender.login']) as sender");
  }
  if (includeHeadSha) {
    selects.push("anyLast(ResourceAttributes['vcs.ref.head.revision']) as headSha");
  }
  if (includeJobCount) {
    selects.push("count(*) as jobCount");
  }

  return `SELECT
    ${selects.join(",\n    ")}
  FROM traces
  WHERE ${whereClause}
  GROUP BY ${groupByAlias}`;
}
