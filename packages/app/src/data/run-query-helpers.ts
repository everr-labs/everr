import { attributeExists, attributeText } from "@everr/telemetry-explorer/sql";

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

/** Text of a resource attribute: `toString(ResourceAttributes.`key`)`. */
export function resourceAttribute(key: string): string {
  return attributeText("ResourceAttributes", key);
}

const PIPELINE_RESULT = resourceAttribute("cicd.pipeline.result");
const TASK_RESULT = resourceAttribute("cicd.pipeline.task.run.result");

export const CONCLUSION_EXPR = `coalesce(nullIf(argMaxIf(${PIPELINE_RESULT}, Timestamp, ${PIPELINE_RESULT} != ''), ''), argMaxIf(${TASK_RESULT}, Timestamp, ${TASK_RESULT} != ''))`;

/**
 * Presence + non-empty check for a resource attribute. The `has` term on the
 * keys array lets the `idx_res_attr_keys` bloom skip index prune granules
 * that lack the key before the value is read.
 */
export function nonEmptyResourceAttribute(key: string): string {
  return `${attributeExists("ResourceAttributes", key)} AND ${resourceAttribute(key)} != ''`;
}

/** Equality on a resource attribute, key-index-prunable via the keys array. */
export function resourceAttributeEquals(key: string, param: string): string {
  return `${attributeExists("ResourceAttributes", key)} AND ${resourceAttribute(key)} = {${param}:String}`;
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
    `anyLast(${resourceAttribute("cicd.pipeline.run.id")}) as run_id`,
    `anyLast(${resourceAttribute("cicd.pipeline.name")}) as workflowName`,
    `anyLast(${resourceAttribute("vcs.repository.name")}) as repo`,
    `anyLast(${resourceAttribute("vcs.ref.head.name")}) as branch`,
    `${CONCLUSION_EXPR} as conclusion`,
    "max(Timestamp) as timestamp",
  ];

  if (includeRunAttempt) {
    selects.push(
      `anyLast(toUInt32OrZero(${resourceAttribute("everr.github.workflow_job.run_attempt")})) as run_attempt`,
    );
  }
  if (includeDuration) {
    selects.push(`max(Duration) / 1000000 as duration`);
  }
  if (includeSender) {
    selects.push(
      `max(${resourceAttribute("cicd.pipeline.task.run.sender.login")}) as sender`,
    );
  }
  if (includeHeadSha) {
    selects.push(
      `anyLast(${resourceAttribute("vcs.ref.head.revision")}) as headSha`,
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
