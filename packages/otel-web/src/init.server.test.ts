// @vitest-environment node
//
// The server half of init(): no window, no document, and no in-house
// pipeline. init() attaches to the app's registered OpenTelemetry SDK via
// the @opentelemetry/api globals; logger and captureError ride the app's
// LoggerProvider and join its active trace context. No SDK registered means
// the API's built-in no-ops: silent, structurally inert.
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureError,
  identify,
  init,
  logger,
  revoke,
  setRouteResolver,
} from "./server.js";
import type { EverrClient } from "./types.js";

let logExporter: InMemoryLogRecordExporter;
let spanExporter: InMemorySpanExporter;
let loggerProvider: LoggerProvider;
let tracerProvider: BasicTracerProvider;
let client: EverrClient | undefined;

function registerSdk(): void {
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
  logExporter = new InMemoryLogRecordExporter();
  loggerProvider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor(logExporter)],
  });
  logs.setGlobalLoggerProvider(loggerProvider);
  spanExporter = new InMemorySpanExporter();
  tracerProvider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
  });
  trace.setGlobalTracerProvider(tracerProvider);
}

beforeEach(() => {
  registerSdk();
});

afterEach(async () => {
  await client?.shutdown();
  client = undefined;
  await loggerProvider.shutdown();
  await tracerProvider.shutdown();
  context.disable();
  logs.disable();
  trace.disable();
  vi.restoreAllMocks();
});

describe("init (server)", () => {
  // First in the file by design: the pre-init warning only exists before
  // the module's first init() call.
  it("warns before init and goes silent after shutdown", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.info("before init");
    captureError(new Error("before init"));
    expect(warn).toHaveBeenCalledTimes(2);

    client = init({ serviceName: "everr-docs-test" });
    await client.shutdown();
    client = undefined;
    warn.mockClear();
    logger.info("after shutdown");
    captureError(new Error("after shutdown"));
    expect(warn).not.toHaveBeenCalled();
    expect(logExporter.getFinishedLogRecords()).toHaveLength(0);
  });

  it("emits custom logs through the app's LoggerProvider", () => {
    client = init({ serviceName: "everr-docs-test" });
    logger.info("ssr render done", { "everr.render.ms": 12 });

    const [record] = logExporter.getFinishedLogRecords();
    expect(record.severityNumber).toBe(9);
    expect(record.severityText).toBe("INFO");
    expect(record.body).toBe("ssr render done");
    expect(record.attributes["everr.render.ms"]).toBe(12);
    expect(record.attributes).not.toHaveProperty("session.id");
  });

  it("correlates logs with the active span context", () => {
    client = init({ serviceName: "everr-docs-test" });
    trace.getTracer("test").startActiveSpan("request", (span) => {
      logger.warn("inside the request");
      span.end();
    });

    const [record] = logExporter.getFinishedLogRecords();
    const [span] = spanExporter.getFinishedSpans();
    expect(record.spanContext?.traceId).toBe(span.spanContext().traceId);
    expect(record.spanContext?.spanId).toBe(span.spanContext().spanId);
  });

  it("reports captureError with the shared exception wire contract", () => {
    client = init({ serviceName: "everr-docs-test" });
    captureError(new Error("ssr boom"), { "everr.loader.route": "/x" });

    const [record] = logExporter.getFinishedLogRecords();
    expect(record.eventName).toBe("exception");
    expect(record.severityNumber).toBe(17);
    const a = record.attributes;
    expect(a["exception.type"]).toBe("Error");
    expect(a["exception.message"]).toBe("ssr boom");
    expect(String(a["exception.stacktrace"])).toContain("ssr boom");
    expect(a["everr.error.handled"]).toBe(true);
    expect(a["everr.error.mechanism"]).toBe("manual");
    expect(a["everr.loader.route"]).toBe("/x");
  });

  it("marks the active span as errored, matching auto-otel-errors", () => {
    client = init({ serviceName: "everr-docs-test" });
    trace.getTracer("test").startActiveSpan("request", (span) => {
      captureError(new Error("boom"));
      span.end();
    });

    const [span] = spanExporter.getFinishedSpans();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.status.message).toBe("Error: boom");
    expect(span.events.map((e) => e.name)).toContain("exception");
  });

  it("treats init options as inert: no pipeline, no network, no lifecycle", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    client = init({
      serviceName: "everr-docs-test",
      ingestKey: "sk_everr_test",
      endpoint: "https://ingest.example.com",
    });
    logger.info("still rides the app's SDK");
    await client.flush();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logExporter.getFinishedLogRecords()).toHaveLength(1);

    // Identity is a browser concept; on the server these never throw and
    // never stamp anything.
    identify("u_123", { plan: "pro" });
    revoke();
    setRouteResolver(() => "/blog/$slug");
    logger.info("after identify");
    const [, record] = logExporter.getFinishedLogRecords();
    expect(Object.keys(record.attributes)).toHaveLength(0);
  });

  it("is a structural no-op when no OTel SDK is registered", async () => {
    logs.disable();
    trace.disable();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    client = init({ serviceName: "everr-docs-test" });
    logger.info("into the void");
    captureError(new Error("also into the void"));
    await client.flush();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logExporter.getFinishedLogRecords()).toHaveLength(0);
  });
});
