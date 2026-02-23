interface RunSummarySubqueryOptions {
  whereClause: string;
  groupByExpr: string;
  groupByAlias: string;
  includeRunAttempt?: boolean;
  includeDuration?: boolean;
  includeSender?: boolean;
  includeJobCount?: boolean;
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
  includeJobCount = false,
}: RunSummarySubqueryOptions): string {
  const selects: string[] = [
    `${groupByExpr} as ${groupByAlias}`,
    "anyLast(ResourceAttributes['cicd.pipeline.run.id']) as run_id",
    "anyLast(ResourceAttributes['cicd.pipeline.name']) as workflowName",
    "anyLast(ResourceAttributes['vcs.repository.name']) as repo",
    "anyLast(ResourceAttributes['vcs.ref.head.name']) as branch",
    "coalesce(nullIf(argMaxIf(ResourceAttributes['cicd.pipeline.result'], Timestamp, ResourceAttributes['cicd.pipeline.result'] != ''), ''), argMaxIf(ResourceAttributes['cicd.pipeline.task.run.result'], Timestamp, ResourceAttributes['cicd.pipeline.task.run.result'] != '')) as conclusion",
    "max(Timestamp) as timestamp",
  ];

  if (includeRunAttempt) {
    selects.push(
      "anyLast(toUInt32OrZero(ResourceAttributes['citric.github.workflow_job.run_attempt'])) as run_attempt",
    );
  }
  if (includeDuration) {
    selects.push("max(Duration) / 1000000 as duration");
  }
  if (includeSender) {
    selects.push(
      "max(ResourceAttributes['cicd.pipeline.task.run.sender.login']) as sender",
    );
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
