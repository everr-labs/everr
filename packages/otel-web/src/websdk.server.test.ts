// @vitest-environment node
//
// The server half of new WebSDK(): no window, no document, and no in-house
// pipeline. new WebSDK() attaches to the app's registered OpenTelemetry SDK via
// the @opentelemetry/api globals; logger and captureError ride the app's
// LoggerProvider and join its active trace context. No SDK registered means
// the API's built-in no-ops: silent, structurally inert.
import { setLogger } from "@everr/otel-errors/core";
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
  logger,
  revoke,
  setAttributes,
  setRouteResolver,
  WebSDK,
} from "./server.js";

let logExporter: InMemoryLogRecordExporter;
let spanExporter: InMemorySpanExporter;
let loggerProvider: LoggerProvider;
let tracerProvider: BasicTracerProvider;
let client: WebSDK | undefined;

function registerSdk(): void {
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
  logExporter = new InMemoryLogRecordExporter();
  loggerProvider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor(logExporter)],
  });
  logs.setGlobalLoggerProvider(loggerProvider);
  // otel-errors resolves its logger once, on the shared client's first use,
  // so a per-test provider swap needs the same rebinding an app gets from
  // ErrorsInstrumentation.setLoggerProvider.
  setLogger(loggerProvider.getLogger("test"));
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
  // the module's first new WebSDK() call.
  it("gates logger on init but never gates error capture", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.info("before init");
    expect(warn).toHaveBeenCalledTimes(1);
    // Errors need no WebSDK on the server: the shared otel-errors client is
    // bound at module load, so this lands.
    captureError(new Error("before init"));
    expect(logExporter.getFinishedLogRecords()).toHaveLength(1);

    client = new WebSDK({ serviceName: "everr-docs-test" });
    await client.shutdown();
    client = undefined;
    warn.mockClear();

    logger.info("after shutdown");
    expect(warn).not.toHaveBeenCalled();
    // Still one record: the logger went silent, the error path did not.
    captureError(new Error("after shutdown"));
    expect(logExporter.getFinishedLogRecords()).toHaveLength(2);
  });

  it("emits custom logs through the app's LoggerProvider", () => {
    client = new WebSDK({ serviceName: "everr-docs-test" });
    logger.info("ssr render done", { "everr.render.ms": 12 });

    const [record] = logExporter.getFinishedLogRecords();
    expect(record.severityNumber).toBe(9);
    expect(record.severityText).toBe("INFO");
    expect(record.body).toBe("ssr render done");
    expect(record.attributes["everr.render.ms"]).toBe(12);
    expect(record.attributes).not.toHaveProperty("session.id");
  });

  it("correlates logs with the active span context", () => {
    client = new WebSDK({ serviceName: "everr-docs-test" });
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
    client = new WebSDK({ serviceName: "everr-docs-test" });
    captureError(new Error("ssr boom"), { "everr.loader.route": "/x" });

    const [record] = logExporter.getFinishedLogRecords();
    expect(record.eventName).toBe("exception");
    expect(record.severityNumber).toBe(17);
    const a = record.attributes;
    expect(a["exception.type"]).toBe("Error");
    expect(a["exception.message"]).toBe("ssr boom");
    expect(String(a["exception.stacktrace"])).toContain("ssr boom");
    expect(a["everr.error.mechanism"]).toBe("manual");
    expect(a["everr.loader.route"]).toBe("/x");
  });

  it("marks the active span as errored, matching otel-errors", () => {
    client = new WebSDK({ serviceName: "everr-docs-test" });
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
    client = new WebSDK({
      serviceName: "everr-docs-test",
      ingestKey: "sk_everr_test",
      endpoint: "https://ingest.example.com",
      // Accepted and ignored: instrumentations are a browser-pipeline concept.
      instrumentations: [
        () => {
          throw new Error("must never run on the server");
        },
      ],
    });
    logger.info("still rides the app's SDK");
    await client.flush();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logExporter.getFinishedLogRecords()).toHaveLength(1);

    // Identity and ambient context are browser concepts; on the server
    // these never throw and never stamp anything.
    identify("u_123", { plan: "pro" });
    revoke();
    setAttributes({ "everr.tenant.id": "acme" });
    setRouteResolver(() => "/blog/$slug");
    logger.info("after identify");
    const [, record] = logExporter.getFinishedLogRecords();
    expect(Object.keys(record.attributes)).toHaveLength(0);
  });

  it("is a structural no-op when no OTel SDK is registered", async () => {
    logs.disable();
    trace.disable();
    // What an SDK-less process actually holds: the API's no-op logger. The
    // rebinding undoes registerSdk's, which a real such process never made.
    setLogger(logs.getLogger("test"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    client = new WebSDK({ serviceName: "everr-docs-test" });
    logger.info("into the void");
    captureError(new Error("also into the void"));
    await client.flush();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logExporter.getFinishedLogRecords()).toHaveLength(0);
  });
});

describe("inert shared-code surface", () => {
  it("instrumentation factories and persistence resolve as no-ops in the server graph", async () => {
    const {
      errors,
      interactions,
      network,
      pageviews,
      performance: performanceInstrumentation,
      setPersistence,
    } = await import("./server.js");
    setPersistence("localStorage");
    const noopContext = {} as never;
    for (const instrumentation of [
      errors({ ignore: ["x"] }),
      pageviews(),
      interactions(),
      performanceInstrumentation({ pageLoad: true }),
      network({ propagateTo: [] } as never),
    ]) {
      expect(instrumentation(noopContext)).toBeUndefined();
    }
  });

  it("drops nullish log attributes, same as the browser emitter", async () => {
    client = new WebSDK({ serviceName: "everr-docs-test" });
    logger.warn("partial attrs", {
      "everr.kept": "yes",
      "everr.dropped": null,
      "everr.gone": undefined,
    });
    await client.flush();
    const [record] = logExporter.getFinishedLogRecords();
    expect(record.attributes).toEqual({ "everr.kept": "yes" });
  });
});
