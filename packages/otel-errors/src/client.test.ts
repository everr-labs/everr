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

  it("never redacts the uid, even when it matches the credit-card pattern", () => {
    // A UUID with many digits, and the first groups contain only digits. If
    // the uid goes through the redaction, the default pattern for a credit
    // card changes the uid to "[Filtered]".
    const uid = "40000000-0000-4000-8000-000000000002";
    const spy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue(uid as ReturnType<typeof crypto.randomUUID>);
    try {
      capture({
        error: new Error("boom"),
        mechanism: "manual",
      });
      const [record] = otel.records();
      expect(record.attributes["log.record.uid"]).toBe(uid);
    } finally {
      spy.mockRestore();
    }
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

  it("rate-limits identical errors", () => {
    configure({ rateLimit: { count: 5, windowMs: 60_000 } });
    const error = new Error("same");
    for (let i = 0; i < 10; i++) {
      capture({ error, mechanism: "manual" });
    }
    expect(otel.records()).toHaveLength(5);
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

  it("redacts message and string attributes", () => {
    capture({
      error: new Error("login failed for a@b.com"),
      mechanism: "manual",
      context: { "url.full": "/cb?token=s3cret" },
    });
    const [record] = otel.records();
    expect(record.body).toBe("Error: login failed for [Filtered]");
    expect(record.attributes["url.full"]).toBe("/cb");
  });

  it("honors custom redaction options", () => {
    configure({
      redactKeys: false,
      redactPatterns: [/secret/g],
    });
    capture({
      error: new Error("secret"),
      mechanism: "manual",
      context: { "x-api-key": "keep" },
    });

    const [record] = otel.records();
    expect(record.body).toBe("Error: [Filtered]");
    expect(record.attributes["x-api-key"]).toBe("keep");
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
