import type { LogAttributes } from "@opentelemetry/api-logs";

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SECRET_ASSIGNMENT_PATTERN =
  /\b(token|password|passwd|secret|api[_-]?key|authorization)=\S+/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;

export function getExceptionAttributes(reason: unknown): LogAttributes {
  if (reason instanceof Error) {
    return removeUndefinedAttributes({
      "exception.type": reason.name || "Error",
      "exception.message": redactSensitiveText(reason.message),
      "exception.stacktrace": reason.stack
        ? redactSensitiveText(reason.stack)
        : undefined,
    });
  }

  return {
    "exception.type": "NonErrorException",
    "exception.message": redactSensitiveText(stringifyReason(reason)),
  };
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(SECRET_ASSIGNMENT_PATTERN, "$1=[REDACTED]")
    .replace(EMAIL_PATTERN, "[REDACTED]");
}

function stringifyReason(reason: unknown): string {
  if (typeof reason === "string") {
    return reason;
  }

  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

function removeUndefinedAttributes(
  attributes: Record<string, string | undefined>,
): LogAttributes {
  return Object.fromEntries(
    Object.entries(attributes).filter(([, value]) => value !== undefined),
  );
}
