export interface Run {
  traceId: string;
  runId: string;
  runAttempt: number;
  repo: string;
  branch: string;
  conclusion: string;
  workflowName: string;
  timestamp: string;
}

export interface Job {
  jobId: string;
  name: string;
  conclusion: string;
  duration: number; // ms
}

export interface Step {
  stepNumber: string;
  name: string;
  conclusion: string;
  duration: number; // ms
  startTime: number; // Unix ms
  endTime: number; // Unix ms
}

export interface LogEntry {
  timestamp: string;
  body: string;
}

export interface Span {
  spanId: string;
  parentSpanId: string;
  name: string;
  startTime: number; // Unix ms
  endTime: number; // Unix ms
  duration: number; // ms
  conclusion: string;
  jobId?: string;
  jobName?: string;
  stepNumber?: string;
  queueTime?: number; // ms - time spent waiting in queue (jobs only)
  // Job-specific attributes
  headBranch?: string;
  headSha?: string;
  runnerName?: string;
  labels?: string;
  sender?: string;
  runAttempt?: number;
  htmlUrl?: string;
  // Test-specific attributes
  testName?: string;
  testResult?: string;
  testDuration?: number;
  testFramework?: string;
  testLanguage?: string;
  isSubtest?: boolean;
  isSuite?: boolean;
}

export const DEFAULT_FAILING_CONTEXT_WINDOW = 50;
export const DEFAULT_RAW_TAIL_LINES = 5000;
export const FAILING_LINE_REGEX_PATTERNS = [
  String.raw`^##\[(error|fatal)\]`,
  String.raw`\bHTTP\s*5\d\d\b|\bstatus\s*[:=]?\s*5\d\d\b`,
  String.raw`\b(?:Assertion|Reference|Syntax|Type|Runtime|Import|ModuleNotFound|Timeout)Error\b`,
  String.raw`\b(?:exit code|exited with code|process completed with exit code)\s*[:=]?\s*[1-9]\d*\b`,
  String.raw`\bSIG(?:SEGV|ABRT|KILL|TERM)\b`,
] as const;
export const FAILING_LINE_SUBSTRINGS = [
  "error",
  "exception",
  "unhandled exception",
  "traceback",
  "stack trace",
  "stacktrace",
  "timeout",
  "timed out",
  "deadline exceeded",
  "context deadline exceeded",
  "operation timed out",
  "request timed out",
  "etimedout",
  "panic",
  "segfault",
  "segmentation fault",
  "fatal",
  "fatal error",
  "assertion failed",
  "outofmemory",
  "out of memory",
  "oomkilled",
  "killed process",
  "econnrefused",
  "connection refused",
  "econnreset",
  "connection reset by peer",
  "broken pipe",
  "enotfound",
  "eai_again",
  "eaddrinuse",
  "network is unreachable",
  "name or service not known",
  "no such host",
  "no such file or directory",
  "cannot find module",
  "module not found",
  "permission denied",
  "access denied",
  "command not found",
  "non-zero exit",
  "returned non-zero exit code",
  "build failed",
  "test failed",
  "tests failed",
  "command failed",
] as const;

export function toSqlStringLiteral(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}

export function buildFailingLinePredicateSql(column = "Body"): string {
  const regexConditions = FAILING_LINE_REGEX_PATTERNS.map(
    (pattern) => `match(${column}, ${toSqlStringLiteral(`(?i)${pattern}`)})`,
  );
  const substringConditions = FAILING_LINE_SUBSTRINGS.map(
    (term) =>
      `positionCaseInsensitive(${column}, ${toSqlStringLiteral(term)}) > 0`,
  );

  return [...regexConditions, ...substringConditions].join("\n\t\t\t\t\t\tOR ");
}

export function buildFailingStepLogsSql(): string {
  return `
		WITH
			step_logs AS (
				SELECT
					Timestamp as timestamp,
					Body as body,
					row_number() OVER (ORDER BY Timestamp ASC) AS line_no,
					(
						${buildFailingLinePredicateSql("Body")}
					) AS is_anchor
				FROM logs
				WHERE TraceId = {traceId:String}
					AND ScopeAttributes['cicd.pipeline.task.name'] = {jobName:String}
					AND LogAttributes['everr.github.workflow_job_step.number'] = {stepNumber:String}
			),
			focused_logs AS (
				SELECT
					timestamp,
					body,
					line_no,
					max(toUInt8(is_anchor)) OVER (
						ORDER BY line_no
						ROWS BETWEEN ${DEFAULT_FAILING_CONTEXT_WINDOW} PRECEDING
							AND ${DEFAULT_FAILING_CONTEXT_WINDOW} FOLLOWING
					) AS near_anchor
				FROM step_logs
			)
		SELECT
			timestamp,
			body
		FROM (
				SELECT
					timestamp,
					body,
					line_no
				FROM focused_logs
				WHERE near_anchor = 1
				ORDER BY line_no DESC
				LIMIT ${DEFAULT_RAW_TAIL_LINES}
			)
		ORDER BY line_no ASC
	`;
}

export function isFailureConclusion(conclusion: string): boolean {
  const normalized = conclusion.trim().toLowerCase();
  return normalized === "failure" || normalized === "failed";
}
