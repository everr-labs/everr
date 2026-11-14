import {
  ERROR_FINGERPRINT_SQL,
  ERROR_MESSAGE_TEMPLATE_SQL,
  EXCEPTION_LOG_FILTER_SQL,
  errorOccurrencesQuery,
} from "@everr/telemetry-explorer/errors";
import { attributeText, attributeTextAny } from "@everr/telemetry-explorer/sql";
import { z } from "zod";
import {
  ANN_ALERTING_LINK_ALERT,
  ANN_DISPLAY_DESCRIPTION,
  ANN_DISPLAY_NAME,
  ANN_ISSUES_KIND,
} from "#app/data/alerting/resource-annotations.ts";
import type { AlertingRuleSpec } from "#app/data/alerting/types.ts";

/**
 * The rule and channel Everr manages when an organization turns on issues for
 * new errors. The repoid is not a repository, so `everr apply` from any real
 * repository never adopts or prunes them.
 */
export const ERROR_ISSUES_REPOID = "everr-managed";
export const ERROR_ISSUES_RULE_NAME = "everr/new-errors";
export const ERROR_ISSUES_CHANNEL_NAME = "everr-new-errors";
const ANN_ENVIRONMENT = "everr.error_issues.environment";

// An error is new while its first occurrence in the lookback is this recent:
// nothing in the week before it. A weekly job's error is not new each week.
const LOOKBACK_DAYS = 14;
const NEW_FOR_DAYS = 7;
// How often a new error must happen in a day before it opens an issue, by
// default. One occurrence is often a fluke that never comes back.
export const DEFAULT_MIN_OCCURRENCES = 2;
const COUNT_WINDOW_HOURS = 24;
const EVALUATION_INTERVAL_SECS = 5 * 60;

/** Errors no code change fixes: the network, a timeout, an upstream being
 *  down. Offered as the starting list of what to skip. */
export const DEFAULT_IGNORED_ERRORS = [
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "socket hang up",
  "AbortError",
  "context canceled",
  "deadline exceeded",
  "502 Bad Gateway",
  "503 Service Unavailable",
  "504 Gateway Timeout",
  "429 Too Many Requests",
];

export const ErrorIssuesIgnoreSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[^\n\r]*$/, { error: "a pattern to skip is one line" }),
  )
  .max(50);

export const MinOccurrencesSchema = z.number().int().min(1).max(1000);

/** An environment name as it appears in `deployment.environment.name`. It is
 *  written into the rule's SQL, so only plain identifier characters pass. */
export const ErrorIssuesEnvironmentSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._-]{1,64}$/, { error: "environment must be a plain name, like production" });

/** A row's environment, under the current semconv key or the older one,
 *  since services in the wild set either. */
export const ENVIRONMENT_SQL = attributeTextAny(
  "ResourceAttributes",
  "deployment.environment.name",
);

// A ClickHouse string literal.
function sqlString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export type NewErrorsOptions = {
  environment: string;
  minOccurrences: number;
  /** Errors whose type or message contains one of these, in any case, never
   *  open an issue. */
  ignore: string[];
};

/**
 * One row per error first seen in the environment in the last week. `value`
 * counts its occurrences in the last day: a trace that logged it counts once,
 * so a retry loop in one request does not outrank an error many users hit.
 * The columns besides `fingerprint` are evidence: the issue text reads them,
 * and the GitHub channel picks the repository from them (see
 * `repositoryForService`). None of them is the raw message, which can hold
 * user data: `message` is its template.
 */
function newErrorsSql({ environment, ignore }: NewErrorsOptions): string {
  const env = ErrorIssuesEnvironmentSchema.parse(environment);
  const patterns = ErrorIssuesIgnoreSchema.parse(ignore);
  const skip =
    patterns.length > 0
      ? `\n    AND NOT multiSearchAnyCaseInsensitive(concat(${attributeText("LogAttributes", "exception.type")}, ' ', ${attributeText("LogAttributes", "exception.message")}), [${patterns.map(sqlString).join(", ")}])`
      : "";
  const occurrences = (where: string) =>
    `countIf(TraceId = ''${where}) + uniqExactIf(TraceId, TraceId != ''${where})`;
  return `SELECT
  fingerprint,
  argMax(ServiceName, Timestamp) AS service,
  argMax(type, Timestamp) AS exception_type,
  argMax(template, Timestamp) AS message,
  argMax(repo_name, Timestamp) AS repository_name,
  argMax(repo_url, Timestamp) AS repository_url,
  argMax(version, Timestamp) AS service_version,
  argMin(version, Timestamp) AS first_seen_version,
  formatDateTime(min(Timestamp), '%Y-%m-%d %H:%i:%S UTC', 'UTC') AS first_seen,
  ${occurrences("")} AS occurrences,
  ${occurrences(` AND Timestamp >= now() - INTERVAL ${COUNT_WINDOW_HOURS} HOUR`)} AS value
FROM (
  SELECT
    Timestamp,
    ServiceName,
    TraceId,
    ${ERROR_FINGERPRINT_SQL} AS fingerprint,
    ${attributeText("LogAttributes", "exception.type")} AS type,
    ${ERROR_MESSAGE_TEMPLATE_SQL} AS template,
    toString(ResourceAttributes.\`vcs.repository.name\`) AS repo_name,
    toString(ResourceAttributes.\`vcs.repository.url.full\`) AS repo_url,
    toString(ResourceAttributes.\`service.version\`) AS version
  FROM logs
  WHERE Timestamp >= now() - INTERVAL ${LOOKBACK_DAYS} DAY
    AND ${EXCEPTION_LOG_FILTER_SQL.trim()}
    AND ${ENVIRONMENT_SQL} = '${env}'${skip}
)
GROUP BY fingerprint
HAVING min(Timestamp) >= now() - INTERVAL ${NEW_FOR_DAYS} DAY
ORDER BY value DESC
LIMIT 100`;
}

/**
 * The issue's text. It names the error and tells the agent how to pull its
 * occurrences from Everr. It copies no stack trace and no raw message: those
 * can hold user data, and an issue outlives Everr's retention and access
 * rules. The title and the evidence carry the message's template, with ids,
 * numbers, emails, and URLs replaced. It is the same handoff as the Errors
 * page's agent prompt.
 */
function errorIssueDescription(environment: string, appBaseUrl: string): string {
  return [
    `A new error in \${service}, first seen in ${environment} at \${first_seen}. Occurrences so far: \${occurrences}.`,
    "",
    `[Open the error in Everr](${new URL("/errors/", appBaseUrl).toString()}\${fingerprint}/modal)`,
    "",
    "### Fix it",
    "",
    "Error fingerprint: `${fingerprint}`",
    "",
    "Pull this error's occurrences, with their messages, stack traces, and trace ids, with `everr cloud query` or the Everr MCP server's `query` tool:",
    "",
    "```sql",
    errorOccurrencesQuery("${fingerprint}"),
    "```",
    "",
    "Then find the root cause and fix the code. When the service reports `service.version`, `first_seen_version` below is the build the error first appeared in: start from what changed in it. The everr-use-telemetry skill documents how errors are fingerprinted.",
    "",
    "Confirm the fix before it ships: start a local collector with `everr local start -d`, reproduce the failing path with the service exporting OpenTelemetry to the collector's `otlp:` endpoint under the same `service.name`, and run the query above with `everr local query`. The local store keeps earlier runs, so note the time before each run and add `AND Timestamp >= '<that time>'` to the query: it returns the reproduced occurrence before the fix and none after it.",
    "",
    "If it cannot be fixed in code, say why in a comment instead of opening a pull request. After this issue closes, Everr watches the release that follows: it reopens the issue if the error happens in it, and comments once it has run a day without the error.",
  ].join("\n");
}

const ANN_MIN_OCCURRENCES = "everr.error_issues.min_occurrences";
const ANN_IGNORE = "everr.error_issues.ignore";

/** The managed rule's spec. `appBaseUrl` makes the links in the issue absolute. */
export function newErrorsRuleSpec(options: NewErrorsOptions, appBaseUrl: string): AlertingRuleSpec {
  const minOccurrences = MinOccurrencesSchema.parse(options.minOccurrences);
  return {
    sql: newErrorsSql(options),
    interval_secs: EVALUATION_INTERVAL_SECS,
    for_secs: 0,
    label_columns: ["fingerprint"],
    condition: { operator: "gte", threshold: minOccurrences },
    severity: "warning",
    annotations: {
      summary: "${exception_type}: ${message}",
      description: errorIssueDescription(options.environment, appBaseUrl),
      [ANN_DISPLAY_NAME]: "New errors",
      [ANN_DISPLAY_DESCRIPTION]: `Errors first seen in ${options.environment} in the last week, once they happen ${minOccurrences} ${minOccurrences === 1 ? "time" : "times"} in a day. Managed by Everr.`,
      [ANN_ENVIRONMENT]: options.environment,
      [ANN_MIN_OCCURRENCES]: String(minOccurrences),
      [ANN_IGNORE]: JSON.stringify(options.ignore),
      [ANN_ISSUES_KIND]: "error",
      [ANN_ALERTING_LINK_ALERT]: new URL(
        `/alerts?alert=${ERROR_ISSUES_RULE_NAME}`,
        appBaseUrl,
      ).toString(),
    },
    resolve_after: 1,
    notifications: { channels: [ERROR_ISSUES_CHANNEL_NAME] },
  };
}

/** The options a managed rule was made with. A rule from before an option
 *  existed reads as its default. */
export function optionsOfRule(spec: AlertingRuleSpec): NewErrorsOptions | null {
  const environment = spec.annotations[ANN_ENVIRONMENT];
  if (!environment) return null;
  const min = MinOccurrencesSchema.safeParse(Number(spec.annotations[ANN_MIN_OCCURRENCES]));
  let ignore: string[] = DEFAULT_IGNORED_ERRORS;
  try {
    const parsed = ErrorIssuesIgnoreSchema.safeParse(
      JSON.parse(spec.annotations[ANN_IGNORE] ?? ""),
    );
    if (parsed.success) ignore = parsed.data;
  } catch {
    // No list saved: the default.
  }
  return {
    environment,
    minOccurrences: min.success ? min.data : DEFAULT_MIN_OCCURRENCES,
    ignore,
  };
}
