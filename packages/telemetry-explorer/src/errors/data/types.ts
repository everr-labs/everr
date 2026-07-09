import type { ErrorTriageEventType } from "../events";

export type ErrorSort = "lastSeen" | "count";

// One append-only triage event (Investigation, Resolution, or status change)
// read back from the logs table, mapped from its everr.error.* attributes.
export type ErrorTriageEvent = {
  type: ErrorTriageEventType;
  /** ClickHouse timestamp string (UTC, space-separated). */
  timestamp: string;
  /** Markdown body as written. */
  body: string;
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
