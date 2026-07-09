import type { LogEventInput } from "../events/emitter";

// Error triage events are plain log rows keyed by tenant + Fingerprint under
// the dedicated everr.error.* attribute namespace (ADR 0004). These constants
// are the single source of truth shared by the write builders and the
// timeline SQL, so the two sides cannot drift.
export const ERROR_EVENT_SERVICE_NAME = "everr-triage";
export const ERROR_EVENT_TYPE_ATTR = "everr.error.event";
export const ERROR_EVENT_FINGERPRINT_ATTR = "everr.error.fingerprint";
export const ERROR_EVENT_AUTHOR_ID_ATTR = "everr.error.author.id";
export const ERROR_EVENT_AUTHOR_NAME_ATTR = "everr.error.author.name";

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

export interface ErrorEventAuthor {
  id: string;
  name: string;
}

export function buildInvestigationEvent(input: {
  fingerprint: string;
  markdown: string;
  author: ErrorEventAuthor;
}): LogEventInput {
  return {
    serviceName: ERROR_EVENT_SERVICE_NAME,
    body: input.markdown,
    attributes: {
      [ERROR_EVENT_TYPE_ATTR]: "investigation",
      [ERROR_EVENT_FINGERPRINT_ATTR]: input.fingerprint,
      [ERROR_EVENT_AUTHOR_ID_ATTR]: input.author.id,
      [ERROR_EVENT_AUTHOR_NAME_ATTR]: input.author.name,
    },
  };
}
