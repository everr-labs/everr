import { type Logger, logs, SeverityNumber } from "@opentelemetry/api-logs";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { invoke } from "@tauri-apps/api/core";

import { TauriLogExporter } from "./telemetry-exporter";

type TelemetryContext = {
  serviceName: string;
  serviceVersion: string;
  serviceInstanceId: string;
  deploymentEnvironment: string;
};

type PendingErrorLog = {
  body: string;
  attributes: Record<string, string | boolean>;
  exception?: Error;
};

let loggerProvider: LoggerProvider | null = null;
let browserErrorLogger: Logger | null = null;
const pendingErrorLogs: PendingErrorLog[] = [];

function emitErrorLog(log: PendingErrorLog) {
  if (!browserErrorLogger) {
    pendingErrorLogs.push(log);
    return;
  }

  browserErrorLogger.emit({
    severityNumber: SeverityNumber.ERROR,
    severityText: "ERROR",
    body: log.body,
    attributes: log.attributes,
    exception: log.exception,
  });
}

function exceptionAttributes(
  type: string,
  message: string,
  stacktrace: string,
  handled: boolean,
): Record<string, string | boolean> {
  return {
    "exception.type": type,
    "exception.message": message,
    "exception.stacktrace": stacktrace,
    "error.handled": handled,
  };
}

window.addEventListener("error", (event) => {
  const error = event.error instanceof Error ? event.error : undefined;
  emitErrorLog({
    body: "everr.browser.error",
    attributes: exceptionAttributes(
      error?.name ?? "Error",
      event.message,
      error?.stack ?? "",
      false,
    ),
    exception: error,
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const error = event.reason instanceof Error ? event.reason : undefined;
  const message = error?.message ?? String(event.reason);
  emitErrorLog({
    body: "everr.browser.unhandled_rejection",
    attributes: exceptionAttributes(
      error?.name ?? "UnhandledRejection",
      message,
      error?.stack ?? "",
      false,
    ),
    exception: error,
  });
});

async function initBrowserTelemetry() {
  const telemetryContext = await invoke<TelemetryContext>(
    "get_telemetry_context",
  );

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: telemetryContext.serviceName,
    "service.version": telemetryContext.serviceVersion,
    "service.instance.id": telemetryContext.serviceInstanceId,
    "deployment.environment.name": telemetryContext.deploymentEnvironment,
  });

  loggerProvider = new LoggerProvider({
    resource,
    processors: [
      new BatchLogRecordProcessor(new TauriLogExporter(), {
        maxQueueSize: 100,
        maxExportBatchSize: 32,
        scheduledDelayMillis: 5_000,
        exportTimeoutMillis: 30_000,
      }),
    ],
  });

  logs.setGlobalLoggerProvider(loggerProvider);
  browserErrorLogger = logs.getLogger("everr-desktop.browser-errors");

  for (const log of pendingErrorLogs.splice(0)) {
    emitErrorLog(log);
  }
}

void initBrowserTelemetry();

window.addEventListener("beforeunload", () => {
  void loggerProvider?.shutdown();
});
