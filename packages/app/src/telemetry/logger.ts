import { type Attributes, context } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { TELEMETRY_SERVICE_NAME } from "./config";

type LogLevel = "debug" | "error" | "info" | "warn";

const severityByLevel: Record<
  LogLevel,
  { severityNumber: SeverityNumber; severityText: string }
> = {
  debug: { severityNumber: SeverityNumber.DEBUG, severityText: "DEBUG" },
  error: { severityNumber: SeverityNumber.ERROR, severityText: "ERROR" },
  info: { severityNumber: SeverityNumber.INFO, severityText: "INFO" },
  warn: { severityNumber: SeverityNumber.WARN, severityText: "WARN" },
};

export function createTelemetryLogger(name: string) {
  const logger = logs.getLogger(name);

  function emit(level: LogLevel, body: string, attributes: Attributes = {}) {
    logger.emit({
      ...severityByLevel[level],
      body,
      attributes,
      context: context.active(),
    });
  }

  return {
    debug: (body: string, attributes?: Attributes) =>
      emit("debug", body, attributes),
    error: (body: string, attributes?: Attributes) =>
      emit("error", body, attributes),
    info: (body: string, attributes?: Attributes) =>
      emit("info", body, attributes),
    warn: (body: string, attributes?: Attributes) =>
      emit("warn", body, attributes),
  };
}

export const serverLogger = createTelemetryLogger(
  `${TELEMETRY_SERVICE_NAME}.server`,
);

export function exceptionAttributes(reason: unknown): Attributes {
  const error = normalizeError(reason);

  return {
    "exception.message": error.message,
    "exception.type": error.name,
    ...(error.stack ? { "exception.stacktrace": error.stack } : {}),
  };
}

function normalizeError(reason: unknown) {
  if (reason instanceof Error) {
    return reason;
  }

  return new Error(String(reason));
}
