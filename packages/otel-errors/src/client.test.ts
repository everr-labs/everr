import { SpanStatusCode, trace } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capture, configure, resetSharedClient, setLogger } from "./capture.js";
import { setupTestTelemetry } from "./test-utils.js";

// Tests for the capture path. They use the exported functions, because the
// process has only one client: the constructor is private, and
// `Client.shared()` gives the only instance. The resetSharedClient() call in
// afterEach keeps each test separate. This is correct, because vitest runs the
// tests in one file in sequence.

let otel: ReturnType<typeof setupTestTelemetry>;

beforeEach(() => {
  otel = setupTestTelemetry();
});

afterEach(async () => {
  resetSharedClient();
  await otel.dispose();
});

describe("the capture path", () => {
  it("emits a semconv log record", () => {
    capture({
      error: new TypeError("boom"),
      mechanism: "manual",
    });
    const [record] = otel.records();
    expect(record.eventName).toBe("exception");
    expect(record.severityNumber).toBe(SeverityNumber.ERROR);
    expect(record.severityText).toBe("ERROR");
    expect(record.body).toBe("TypeError: boom");
    expect(record.attributes["exception.type"]).toBe("TypeError");
    expect(record.attributes["exception.message"]).toBe("boom");
    expect(record.attributes["exception.stacktrace"]).toContain(
      "client.test.ts",
    );
    expect(record.attributes["everr.error.mechanism"]).toBe("manual");
    expect(record.attributes["log.record.uid"]).toMatch(/^[0-9a-f-]{32,36}$/);
  });

  it("maps fatal severity", () => {
    capture({
      error: new Error("dead"),
      mechanism: "uncaughtException",
      severity: "fatal",
    });
    const [record] = otel.records();
    expect(record.severityNumber).toBe(SeverityNumber.FATAL);
    expect(record.severityText).toBe("FATAL");
  });

  it("sends every report of the same error, with no throttle", () => {
    // The package discards no record. A loop that reports the same error keeps
    // one record for each call. A volume limit belongs to the collector or to
    // the ingest, which see all the processes.
    const error = new Error("same");
    for (let i = 0; i < 50; i++) {
      capture({ error, mechanism: "manual" });
    }
    expect(otel.records()).toHaveLength(50);
  });

  it("beforeSend can mutate and drop events", () => {
    configure({
      beforeSend: (event) => {
        if (event.message.includes("drop-me")) return null;
        event.context = { ...event.context, app: "test" };
        return event;
      },
    });
    capture({
      error: new Error("drop-me"),
      mechanism: "manual",
    });
    capture({
      error: new Error("keep"),
      mechanism: "manual",
    });
    const records = otel.records();
    expect(records).toHaveLength(1);
    expect(records[0].attributes.app).toBe("test");
  });

  it("removes nothing from the message and the attributes", () => {
    // The package applies no pattern and no key list. The message, the query
    // string, and an attribute whose key looks sensitive all go out without a
    // change. The application removes what it must remove, in beforeSend.
    capture({
      error: new Error("login failed for a@b.com"),
      mechanism: "manual",
      context: { "url.full": "/cb?token=s3cret", "x-api-key": "k123" },
    });
    const [record] = otel.records();
    expect(record.body).toBe("Error: login failed for a@b.com");
    expect(record.attributes["url.full"]).toBe("/cb?token=s3cret");
    expect(record.attributes["x-api-key"]).toBe("k123");
  });

  it("ignores re-entrant captures", () => {
    configure({
      beforeSend: (event) => {
        capture({
          error: new Error("nested"),
          mechanism: "manual",
        });
        return event;
      },
    });
    capture({
      error: new Error("outer"),
      mechanism: "manual",
    });
    expect(otel.records()).toHaveLength(1);
  });

  it("emits the error log in the active span's trace context", () => {
    const tracer = trace.getTracer("test");
    tracer.startActiveSpan("request", (requestSpan) => {
      capture({
        error: new Error("in-trace"),
        mechanism: "manual",
      });
      requestSpan.end();
    });

    const [record] = otel.records();
    const requestSpan = otel.spans().find((s) => s.name === "request");
    expect(record.spanContext?.traceId).toBe(
      requestSpan?.spanContext().traceId,
    );
  });

  it("marks the active span as errored", () => {
    trace.getTracer("test").startActiveSpan("request", (requestSpan) => {
      capture({
        error: new Error("boom"),
        mechanism: "manual",
      });
      requestSpan.end();
    });

    const requestSpan = otel.spans().find((s) => s.name === "request");
    expect(requestSpan?.status.code).toBe(SpanStatusCode.ERROR);
    expect(requestSpan?.status.message).toBe("Error: boom");
    expect(requestSpan?.events.map((e) => e.name)).toContain("exception");
  });

  it("marks the span from the error, not from the beforeSend result", () => {
    configure({
      beforeSend: (event) => ({ ...event, message: "record only" }),
    });
    trace.getTracer("test").startActiveSpan("request", (requestSpan) => {
      capture({ error: new Error("boom"), mechanism: "manual" });
      requestSpan.end();
    });

    const requestSpan = otel.spans().find((s) => s.name === "request");
    expect(otel.records()[0]?.body).toBe("record only");
    // The span carries the values of the error. A hook that changes the record
    // does not reach it. The app uses a span processor or the collector for
    // the span.
    expect(requestSpan?.status.message).toBe("Error: boom");
    const exception = requestSpan?.events.find((e) => e.name === "exception");
    expect(exception?.attributes?.["exception.message"]).toBe("boom");
  });

  it("beforeSend redacts the body and the exception attributes, not the span", () => {
    configure({
      beforeSend: (event) => {
        event.message = "[redacted]";
        event.exception.message = "[redacted]";
        event.exception.stacktrace = undefined;
        return event;
      },
    });
    trace.getTracer("test").startActiveSpan("request", (requestSpan) => {
      capture({ error: new Error("secret token"), mechanism: "manual" });
      requestSpan.end();
    });

    const [record] = otel.records();
    expect(record.body).toBe("[redacted]");
    expect(record.attributes["exception.message"]).toBe("[redacted]");
    expect(record.attributes["exception.stacktrace"]).toBeUndefined();
    // The span keeps the values of the error: the documented policy.
    const requestSpan = otel.spans().find((s) => s.name === "request");
    expect(requestSpan?.status.message).toBe("Error: secret token");
  });

  it("discards the record and the span marking together on a null beforeSend", () => {
    configure({ beforeSend: () => null });
    trace.getTracer("test").startActiveSpan("request", (requestSpan) => {
      capture({ error: new Error("boom"), mechanism: "manual" });
      requestSpan.end();
    });

    const requestSpan = otel.spans().find((s) => s.name === "request");
    expect(otel.records()).toHaveLength(0);
    expect(requestSpan?.status.code).toBe(SpanStatusCode.UNSET);
    expect(requestSpan?.events).toHaveLength(0);
  });

  it("setLogger redirects emission to a provider's logger", () => {
    const emit = vi.fn();
    setLogger({ emit } as unknown as Parameters<typeof setLogger>[0]);
    capture({
      error: new Error("routed"),
      mechanism: "manual",
    });

    expect(otel.records()).toHaveLength(0);
    expect(emit).toHaveBeenCalledOnce();
    expect(emit.mock.calls[0][0]).toMatchObject({ eventName: "exception" });
  });

  it("emits no error.context span", () => {
    capture({
      error: new Error("bare"),
      mechanism: "manual",
    });
    expect(otel.spans()).toHaveLength(0);
  });
});
