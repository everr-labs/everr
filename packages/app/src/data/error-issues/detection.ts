import {
  ERROR_FINGERPRINT_SQL,
  EXCEPTION_LOG_FILTER_SQL,
  errorOccurrencesQuery,
} from "@everr/telemetry-explorer/errors";
import { attributeTextAny } from "@everr/telemetry-explorer/sql";
import { z } from "zod";
import {
  ANN_ALERTING_LINK_ALERT,
  ANN_DISPLAY_DESCRIPTION,
  ANN_DISPLAY_NAME,
  ANN_ISSUES_QUIET,
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

// An error is new while its fingerprint was first seen this recently, looking
// back over the history window. It keeps firing while it still occurs.
const HISTORY_DAYS = 7;
const NEW_FOR_HOURS = 24;
const OCCURRING_MINUTES = 15;
const EVALUATION_INTERVAL_SECS = 5 * 60;
const MESSAGE_MAX = 500;

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

/**
 * One row per error fingerprint first seen in the environment within the
 * last day, with `value` counting its occurrences in the last few minutes.
 * The columns besides `fingerprint` are evidence: the issue text reads them,
 * and the GitHub channel picks the repository from them (see
 * `repositoryForService`).
 */
function newErrorsSql(environment: string): string {
  const env = ErrorIssuesEnvironmentSchema.parse(environment);
  return `SELECT
  fingerprint,
  argMax(ServiceName, Timestamp) AS service,
  argMax(exception_type, Timestamp) AS exception_type,
  argMax(exception_message, Timestamp) AS exception_message,
  argMax(repository_name, Timestamp) AS repository_name,
  argMax(repository_url, Timestamp) AS repository_url,
  argMax(service_version, Timestamp) AS service_version,
  formatDateTime(min(Timestamp), '%Y-%m-%d %H:%i:%S UTC', 'UTC') AS first_seen,
  count() AS occurrences,
  countIf(Timestamp >= now() - INTERVAL ${OCCURRING_MINUTES} MINUTE) AS value
FROM (
  SELECT
    Timestamp,
    ServiceName,
    ${ERROR_FINGERPRINT_SQL} AS fingerprint,
    toString(LogAttributes.\`exception.type\`) AS exception_type,
    substring(toString(LogAttributes.\`exception.message\`), 1, ${MESSAGE_MAX}) AS exception_message,
    toString(ResourceAttributes.\`vcs.repository.name\`) AS repository_name,
    toString(ResourceAttributes.\`vcs.repository.url.full\`) AS repository_url,
    toString(ResourceAttributes.\`service.version\`) AS service_version
  FROM logs
  WHERE Timestamp >= now() - INTERVAL ${HISTORY_DAYS} DAY
    AND ${EXCEPTION_LOG_FILTER_SQL.trim()}
    AND ${ENVIRONMENT_SQL} = '${env}'
)
GROUP BY fingerprint
HAVING min(Timestamp) >= now() - INTERVAL ${NEW_FOR_HOURS} HOUR
ORDER BY value DESC
LIMIT 100`;
}

/**
 * The issue's text. It names the error and tells the agent how to pull its
 * occurrences from Everr, and copies no telemetry: stack traces and messages
 * can hold user data, and an issue outlives Everr's retention and access
 * rules. It is the same handoff as the Errors page's agent prompt.
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
    "Pull this error's occurrences, with their stack traces and trace ids, with `everr cloud query` or the Everr MCP server's `query` tool:",
    "",
    "```sql",
    errorOccurrencesQuery("${fingerprint}"),
    "```",
    "",
    "Then find the root cause and fix the code. The everr-use-telemetry skill documents how errors are fingerprinted.",
    "",
    "Confirm the fix before it ships: start a local collector with `everr local start -d`, reproduce the failing path with the service exporting OpenTelemetry to the collector's `otlp:` endpoint under the same `service.name`, and run the query above with `everr local query`. The local store keeps earlier runs, so note the time before each run and add `AND Timestamp >= '<that time>'` to the query: it returns the reproduced occurrence before the fix and none after it.",
  ].join("\n");
}

/** The managed rule's spec. `appBaseUrl` makes the links in the issue absolute. */
export function newErrorsRuleSpec(environment: string, appBaseUrl: string): AlertingRuleSpec {
  return {
    sql: newErrorsSql(environment),
    interval_secs: EVALUATION_INTERVAL_SECS,
    for_secs: 0,
    label_columns: ["fingerprint"],
    condition: { operator: "gt", threshold: 0 },
    severity: "warning",
    annotations: {
      summary: "${exception_type}: ${exception_message}",
      description: errorIssueDescription(environment, appBaseUrl),
      [ANN_DISPLAY_NAME]: "New errors",
      [ANN_DISPLAY_DESCRIPTION]: `Errors first seen in ${environment} in the last day. Managed by Everr.`,
      [ANN_ENVIRONMENT]: environment,
      // The rule resolves when an error goes quiet for a few minutes or stops
      // counting as new, neither of which says it was fixed.
      [ANN_ISSUES_QUIET]: "true",
      [ANN_ALERTING_LINK_ALERT]: new URL(
        `/alerts?alert=${ERROR_ISSUES_RULE_NAME}`,
        appBaseUrl,
      ).toString(),
    },
    resolve_after: 1,
    notifications: { channels: [ERROR_ISSUES_CHANNEL_NAME] },
  };
}

export function environmentOfRule(spec: AlertingRuleSpec): string | null {
  return spec.annotations[ANN_ENVIRONMENT] ?? null;
}
