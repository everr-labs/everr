import { context, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

export function setupTestTelemetry() {
  const contextManager = new AsyncLocalStorageContextManager();
  context.setGlobalContextManager(contextManager.enable());

  const logExporter = new InMemoryLogRecordExporter();
  const loggerProvider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor(logExporter)],
  });
  logs.setGlobalLoggerProvider(loggerProvider);

  const spanExporter = new InMemorySpanExporter();
  const tracerProvider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
  });
  trace.setGlobalTracerProvider(tracerProvider);

  return {
    records: () => logExporter.getFinishedLogRecords(),
    spans: () => spanExporter.getFinishedSpans(),
    reset() {
      logExporter.reset();
      spanExporter.reset();
    },
    async dispose() {
      await loggerProvider.shutdown();
      await tracerProvider.shutdown();
      context.disable();
      logs.disable();
      trace.disable();
    },
  };
}
