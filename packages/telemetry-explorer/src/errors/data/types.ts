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
