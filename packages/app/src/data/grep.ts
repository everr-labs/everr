import { z } from "zod";
import { query } from "@/lib/clickhouse";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import {
  isValidDatemath,
  resolveTimeRange,
  type TimeRange,
  TimeRangeSchema,
} from "@/lib/time-range";

const MAX_RECENT_OCCURRENCES_PER_BRANCH = 5;
const MAX_MATCHED_LINES_PER_OCCURRENCE = 3;
export const MAX_GREP_LOOKBACK_DAYS = 30;
const UNKNOWN_BRANCH = "(unknown)";
const MAX_GREP_LOOKBACK_MS = MAX_GREP_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
const MAX_GREP_LOOKBACK_EPSILON_MS = 1000;
const RUN_CONCLUSION_EXPR =
  "coalesce(nullIf(argMaxIf(ResourceAttributes['cicd.pipeline.result'], Timestamp, ResourceAttributes['cicd.pipeline.result'] != ''), ''), argMaxIf(ResourceAttributes['cicd.pipeline.task.run.result'], Timestamp, ResourceAttributes['cicd.pipeline.task.run.result'] != ''))";

const GrepInputSchema = z
  .object({
    timeRange: TimeRangeSchema,
    repo: z.string().min(1),
    pattern: z.string().min(1),
    jobName: z.string().min(1).optional(),
    stepNumber: z.string().min(1).optional(),
    branch: z.string().min(1).optional(),
    excludeBranch: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine(
    (data) => data.jobName === undefined || data.stepNumber !== undefined,
    {
      message: "Provide both jobName and stepNumber together.",
      path: ["stepNumber"],
    },
  )
  .refine(
    (data) => data.stepNumber === undefined || data.jobName !== undefined,
    {
      message: "Provide both jobName and stepNumber together.",
      path: ["jobName"],
    },
  )
  .refine((data) => !(data.branch && data.excludeBranch), {
    message: "Provide either branch or excludeBranch, not both.",
    path: ["excludeBranch"],
  });

export type GrepInput = z.infer<typeof GrepInputSchema>;

export interface GrepOccurrence {
  traceId: string;
  runId: string;
  runAttempt: number;
  workflowName: string;
  jobName: string;
  stepNumber: string;
  stepName: string;
  stepConclusion: string;
  runConclusion: string;
  stepDuration: number;
  timestamp: string;
  matchCount: number;
  matchedLines: string[];
}

export interface GrepBranchItem {
  branch: string;
  occurrenceCount: number;
  lastSeen: string;
  recentOccurrences: GrepOccurrence[];
}

export interface GrepResult {
  repo: string;
  pattern: string;
  jobName: string | null;
  stepNumber: string | null;
  branch: string | null;
  excludedBranch: string | null;
  timeRange: {
    from: string;
    to: string;
  };
  limit: number;
  items: GrepBranchItem[];
}

interface GrepSqlParts {
  params: Record<string, unknown>;
  whereClause: string;
}

interface GrepBranchRow {
  branch: string;
  occurrence_count: string;
  last_seen: string;
}

interface GrepDetailRow {
  branch: string;
  trace_id: string;
  run_id: string;
  run_attempt: string;
  workflow_name: string;
  job_name: string;
  step_number: string;
  step_name: string;
  step_conclusion: string;
  run_conclusion: string;
  step_duration: string;
  timestamp: string;
  match_count: string;
  matched_line: string;
}

export function getGrepTimeRangeValidationError(
  timeRange: TimeRange,
): string | null {
  if (!isValidDatemath(timeRange.from) || !isValidDatemath(timeRange.to)) {
    return "Invalid time range. Use supported datemath expressions or ISO timestamps.";
  }

  const { fromDate, toDate } = resolveTimeRange(timeRange);
  if (fromDate >= toDate) {
    return "Invalid time range. `from` must be earlier than `to`.";
  }

  if (
    toDate.getTime() - fromDate.getTime() >
    MAX_GREP_LOOKBACK_MS + MAX_GREP_LOOKBACK_EPSILON_MS
  ) {
    return `Invalid time range. Grep supports a maximum lookback of ${MAX_GREP_LOOKBACK_DAYS} days.`;
  }

  return null;
}

function buildGrepSqlParts(
  data: GrepInput,
  fromISO: string,
  toISO: string,
): GrepSqlParts {
  const conditions = [
    "t.Timestamp >= {fromTime:String} AND t.Timestamp <= {toTime:String}",
    "t.ResourceAttributes['vcs.repository.name'] = {repo:String}",
    "t.SpanAttributes['everr.github.workflow_job_step.number'] != ''",
    "lowerUTF8(t.StatusMessage) IN ('failure', 'failed')",
    "positionCaseInsensitive(l.Body, {pattern:String}) > 0",
  ];
  const params: Record<string, unknown> = {
    fromTime: fromISO,
    toTime: toISO,
    repo: data.repo,
    pattern: data.pattern,
  };

  if (data.jobName) {
    conditions.push(
      "t.ResourceAttributes['cicd.pipeline.task.name'] = {jobName:String}",
    );
    params.jobName = data.jobName;
  }

  if (data.stepNumber) {
    conditions.push(
      "t.SpanAttributes['everr.github.workflow_job_step.number'] = {stepNumber:String}",
    );
    params.stepNumber = data.stepNumber;
  }

  if (data.branch) {
    conditions.push(
      "t.ResourceAttributes['vcs.ref.head.name'] = {branch:String}",
    );
    params.branch = data.branch;
  }

  if (data.excludeBranch) {
    conditions.push(
      "t.ResourceAttributes['vcs.ref.head.name'] != {excludeBranch:String}",
    );
    params.excludeBranch = data.excludeBranch;
  }

  return {
    params,
    whereClause: conditions.join("\n        AND "),
  };
}

function branchExpr(alias: string): string {
  return `coalesce(nullIf(${alias}.ResourceAttributes['vcs.ref.head.name'], ''), '${UNKNOWN_BRANCH}')`;
}

function buildBranchSummarySql(whereClause: string): string {
  return `
    WITH matching_occurrences AS (
      SELECT
        ${branchExpr("t")} as branch,
        t.TraceId as trace_id,
        anyLast(l.Timestamp) as last_matched_at
      FROM traces t
      INNER JOIN logs l
        ON l.TraceId = t.TraceId
        AND l.ScopeAttributes['cicd.pipeline.task.name'] = t.ResourceAttributes['cicd.pipeline.task.name']
        AND l.LogAttributes['everr.github.workflow_job_step.number'] = t.SpanAttributes['everr.github.workflow_job_step.number']
      WHERE ${whereClause}
      GROUP BY branch, trace_id, t.ResourceAttributes['cicd.pipeline.task.name'], t.SpanAttributes['everr.github.workflow_job_step.number']
    )
    SELECT
      branch,
      count(*) as occurrence_count,
      max(last_matched_at) as last_seen
    FROM matching_occurrences
    GROUP BY branch
    ORDER BY last_seen DESC, occurrence_count DESC, branch ASC
    LIMIT {limit:UInt32} OFFSET {offset:UInt32}
  `;
}

function buildOccurrenceDetailsSql(whereClause: string): string {
  return `
    WITH run_conclusions AS (
      SELECT
        TraceId as trace_id,
        ${RUN_CONCLUSION_EXPR} as run_conclusion
      FROM traces
      GROUP BY trace_id
    ),
    matching_lines AS (
      SELECT
        ${branchExpr("t")} as branch,
        t.TraceId as trace_id,
        t.ResourceAttributes['cicd.pipeline.run.id'] as run_id,
        toUInt32OrZero(t.ResourceAttributes['everr.github.workflow_job.run_attempt']) as run_attempt,
        t.ResourceAttributes['cicd.pipeline.name'] as workflow_name,
        t.ResourceAttributes['cicd.pipeline.task.name'] as job_name,
        t.SpanAttributes['everr.github.workflow_job_step.number'] as step_number,
        t.SpanName as step_name,
        t.StatusMessage as step_conclusion,
        rc.run_conclusion as run_conclusion,
        if(lowerUTF8(t.StatusMessage) = 'skip', toFloat64(0), t.Duration / 1000000) as step_duration,
        l.Timestamp as matched_at,
        l.Body as matched_line
      FROM traces t
      INNER JOIN logs l
        ON l.TraceId = t.TraceId
        AND l.ScopeAttributes['cicd.pipeline.task.name'] = t.ResourceAttributes['cicd.pipeline.task.name']
        AND l.LogAttributes['everr.github.workflow_job_step.number'] = t.SpanAttributes['everr.github.workflow_job_step.number']
      INNER JOIN run_conclusions rc
        ON rc.trace_id = t.TraceId
      WHERE ${whereClause}
        AND ${branchExpr("t")} IN {branches:Array(String)}
    ),
    occurrence_summary AS (
      SELECT
        branch,
        trace_id,
        run_id,
        run_attempt,
        workflow_name,
        job_name,
        step_number,
        step_name,
        anyLast(step_conclusion) as step_conclusion,
        anyLast(run_conclusion) as run_conclusion,
        anyLast(step_duration) as step_duration,
        max(matched_at) as timestamp,
        count(*) as match_count
      FROM matching_lines
      GROUP BY
        branch,
        trace_id,
        run_id,
        run_attempt,
        workflow_name,
        job_name,
        step_number,
        step_name
    ),
    ranked_occurrences AS (
      SELECT
        *,
        row_number() OVER (
          PARTITION BY branch
          ORDER BY timestamp DESC, trace_id ASC, job_name ASC, toUInt32OrZero(step_number) ASC
        ) as occurrence_rank
      FROM occurrence_summary
    ),
    ranked_lines AS (
      SELECT
        ro.branch,
        ro.trace_id,
        ro.run_id,
        ro.run_attempt,
        ro.workflow_name,
        ro.job_name,
        ro.step_number,
        ro.step_name,
        ro.step_conclusion,
        ro.run_conclusion,
        ro.step_duration,
        ro.timestamp,
        ro.match_count,
        ml.matched_line,
        row_number() OVER (
          PARTITION BY ro.branch, ro.trace_id, ro.job_name, ro.step_number
          ORDER BY ml.matched_at ASC, ml.matched_line ASC
        ) as line_rank
      FROM ranked_occurrences ro
      INNER JOIN matching_lines ml
        ON ml.branch = ro.branch
        AND ml.trace_id = ro.trace_id
        AND ml.job_name = ro.job_name
        AND ml.step_number = ro.step_number
      WHERE ro.occurrence_rank <= {occurrenceLimit:UInt32}
    )
    SELECT
      branch,
      trace_id,
      run_id,
      run_attempt,
      workflow_name,
      job_name,
      step_number,
      step_name,
      step_conclusion,
      run_conclusion,
      step_duration,
      timestamp,
      match_count,
      matched_line
    FROM ranked_lines
    WHERE line_rank <= {lineLimit:UInt32}
    ORDER BY branch ASC, timestamp DESC, trace_id ASC, job_name ASC, toUInt32OrZero(step_number) ASC, line_rank ASC
  `;
}

function buildGrepResult(data: GrepInput, items: GrepBranchItem[]): GrepResult {
  return {
    repo: data.repo,
    pattern: data.pattern,
    jobName: data.jobName ?? null,
    stepNumber: data.stepNumber ?? null,
    branch: data.branch ?? null,
    excludedBranch: data.excludeBranch ?? null,
    timeRange: data.timeRange,
    limit: data.limit,
    items,
  };
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, createValue: () => V): V {
  const existing = map.get(key);
  if (existing) {
    return existing;
  }

  const value = createValue();
  map.set(key, value);
  return value;
}

function buildOccurrenceKey(
  row: Pick<GrepDetailRow, "trace_id" | "job_name" | "step_number">,
): string {
  return `${row.trace_id}\u0000${row.job_name}\u0000${row.step_number}`;
}

function buildOccurrence(row: GrepDetailRow): GrepOccurrence {
  return {
    traceId: row.trace_id,
    runId: row.run_id,
    runAttempt: Number(row.run_attempt),
    workflowName: row.workflow_name || "Workflow",
    jobName: row.job_name || "Job",
    stepNumber: row.step_number,
    stepName: row.step_name || "Step",
    stepConclusion: row.step_conclusion || "unknown",
    runConclusion: row.run_conclusion || "unknown",
    stepDuration: Number(row.step_duration),
    timestamp: row.timestamp,
    matchCount: Number(row.match_count),
    matchedLines: [row.matched_line],
  };
}

function collectOccurrencesByBranch(
  detailRows: GrepDetailRow[],
): Map<string, GrepOccurrence[]> {
  const occurrencesByBranch = new Map<string, GrepOccurrence[]>();
  const occurrencesByKeyByBranch = new Map<
    string,
    Map<string, GrepOccurrence>
  >();

  for (const row of detailRows) {
    const branchOccurrences = getOrCreate(
      occurrencesByBranch,
      row.branch,
      () => [],
    );
    const occurrencesByKey = getOrCreate(
      occurrencesByKeyByBranch,
      row.branch,
      () => new Map(),
    );
    const occurrenceKey = buildOccurrenceKey(row);
    const occurrence = occurrencesByKey.get(occurrenceKey);

    if (occurrence) {
      if (occurrence.matchedLines.length < MAX_MATCHED_LINES_PER_OCCURRENCE) {
        occurrence.matchedLines.push(row.matched_line);
      }
      continue;
    }

    const nextOccurrence = buildOccurrence(row);
    occurrencesByKey.set(occurrenceKey, nextOccurrence);
    branchOccurrences.push(nextOccurrence);
  }

  return occurrencesByBranch;
}

export const getGrepMatches = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(GrepInputSchema)
  .handler(async ({ data }) => {
    const timeRangeError = getGrepTimeRangeValidationError(data.timeRange);
    if (timeRangeError) {
      throw new Error(timeRangeError);
    }

    const { fromISO, toISO } = resolveTimeRange(data.timeRange);
    const { params, whereClause } = buildGrepSqlParts(data, fromISO, toISO);

    const branchRows = await query<GrepBranchRow>(
      buildBranchSummarySql(whereClause),
      {
        ...params,
        limit: data.limit ?? 20,
        offset: data.offset ?? 0,
      },
    );

    if (branchRows.length === 0) {
      return buildGrepResult(data, []);
    }

    const branches = branchRows.map((row) => row.branch);
    const detailRows = await query<GrepDetailRow>(
      buildOccurrenceDetailsSql(whereClause),
      {
        ...params,
        branches,
        occurrenceLimit: MAX_RECENT_OCCURRENCES_PER_BRANCH,
        lineLimit: MAX_MATCHED_LINES_PER_OCCURRENCE,
      },
    );
    const occurrencesByBranch = collectOccurrencesByBranch(detailRows);

    const items = branchRows.map((row) => {
      return {
        branch: row.branch,
        occurrenceCount: Number(row.occurrence_count),
        lastSeen: row.last_seen,
        recentOccurrences:
          occurrencesByBranch
            .get(row.branch)
            ?.slice(0, MAX_RECENT_OCCURRENCES_PER_BRANCH) ?? [],
      } satisfies GrepBranchItem;
    });

    return buildGrepResult(data, items);
  });
