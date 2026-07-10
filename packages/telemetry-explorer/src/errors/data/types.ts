export type ErrorSort = "lastSeen" | "count";

export const ERROR_TRIAGE_EVENT_TYPES = [
  "investigation",
  "resolved",
  "ignored",
  "reopened",
] as const;
export type ErrorTriageEventType = (typeof ERROR_TRIAGE_EVENT_TYPES)[number];

export function isErrorTriageEventType(
  value: string,
): value is ErrorTriageEventType {
  return (ERROR_TRIAGE_EVENT_TYPES as readonly string[]).includes(value);
}

// Triage event types that change an Error's derived Status (everything but
// investigation).
export const ERROR_STATUS_EVENT_TYPES = [
  "resolved",
  "ignored",
  "reopened",
] as const;
export type ErrorStatusEventType = (typeof ERROR_STATUS_EVENT_TYPES)[number];

export function isErrorStatusEventType(
  value: string,
): value is ErrorStatusEventType {
  return (ERROR_STATUS_EVENT_TYPES as readonly string[]).includes(value);
}

// The latest surviving status event of one Error, read from the events table
// ahead of the summary query, which takes it as plain parameters (spec 0001).
export type ErrorTriageStatus = {
  fingerprint: string;
  type: ErrorStatusEventType;
  /** Time of the winning status event (ClickHouse timestamp string, UTC). */
  at: string;
  /**
   * Resolution events only: the service versions known for the Error's
   * services at resolve time. An Occurrence from a version outside this set
   * is a Regression; empty means no version knowledge and the rule degrades
   * to timestamp comparison.
   */
  resolvedVersions: string[];
};

// Derived triage Status (spec 0001): computed at read time from the latest
// status event plus the Occurrence timestamps; never stored anywhere.
export const ERROR_STATUSES = ["open", "resolved", "ignored"] as const;
export type ErrorStatus = (typeof ERROR_STATUSES)[number];

export const ERROR_STATUS_LABELS: Record<ErrorStatus, string> = {
  open: "Open",
  resolved: "Resolved",
  ignored: "Ignored",
};

export function isErrorStatus(value: unknown): value is ErrorStatus {
  return (ERROR_STATUSES as readonly unknown[]).includes(value);
}

// One triage entry (Investigation, Resolution, or status change) resolved to
// its latest version from the error_triage_events table (ADR 0004).
export type ErrorTriageEvent = {
  /** Stable identity of the entry across edits (event_id). */
  id: string;
  type: ErrorTriageEventType;
  /** Original creation time (ClickHouse timestamp string, UTC). */
  timestamp: string;
  /** Time of the latest version. */
  updatedAt: string;
  /** True when the entry was edited after creation. */
  edited: boolean;
  /** Markdown body of the latest version. */
  body: string;
  /** Display name resolves from the user profile at read time; storage holds the id only. */
  author: { id: string; name: string };
};

export type ErrorIssueSummary = {
  /**
   * Derived triage Status. Present only on surfaces with triage capability
   * (the repository's triageEvents option); local/desktop summaries carry no
   * Status until the Collector grows a counterpart events table.
   */
  status?: ErrorStatus;
  /**
   * True when a resolved Error was reopened by the Regression rule (spec
   * 0001): an Occurrence from a version outside the Resolution's
   * resolve-time snapshot (see ErrorTriageStatus.resolvedVersions), or a
   * versionless Occurrence newer than it. Always false for a manual reopen.
   * Present exactly when status is.
   */
  regressed?: boolean;
  fingerprint: string;
  exceptionType: string;
  exceptionMessage: string;
  body: string;
  latestServiceName: string;
  services: string[];
  occurrenceCount: number;
  traceCount: number;
  firstSeen: string;
  lastSeen: string;
  latestTraceId: string;
  latestSpanId: string;
  latestTimestamp: string;
};

export type ErrorIssuesResult = {
  issues: ErrorIssueSummary[];
};

export type ErrorOccurrence = {
  timestampRank?: number;
  fingerprint: string;
  timestamp: string;
  serviceName: string;
  traceId: string;
  spanId: string;
  body: string;
  exceptionType: string;
  exceptionMessage: string;
  exceptionStacktrace: string;
  resourceAttributes: Record<string, string>;
  logAttributes: Record<string, string>;
  scopeAttributes: Record<string, string>;
};

export type ErrorIssueDetail = {
  summary: ErrorIssueSummary;
  latest: ErrorOccurrence;
  occurrences: ErrorOccurrence[];
};

// Source-agnostic span shape for the related-trace panel. The web app maps its
// runs/CI spans into this; desktop maps telemetry trace spans into this.
export type RelatedSpan = {
  spanId: string;
  parentSpanId: string;
  name: string;
  durationMs: number;
  conclusion?: string;
  jobName?: string;
};
