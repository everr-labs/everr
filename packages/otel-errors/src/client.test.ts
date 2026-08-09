import { SpanStatusCode, trace } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "./client.js";
import { setupTestTelemetry } from "./test-utils.js";
import type { Options } from "./types.js";

let otel: ReturnType<typeof setupTestTelemetry>;

beforeEach(() => {
  otel = setupTestTelemetry();
});

afterEach(async () => {
  await otel.dispose();
});

function makeClient(options: Options = {}) {
  return new Client(options);
}

describe("Client.capture", () => {
  it("emits a semconv log record", () => {
    makeClient().capture({
      error: new TypeError("boom"),
      mechanism: "manual",
      handled: true,
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
    expect(record.attributes["everr.error.handled"]).toBe(true);
    expect(record.attributes["everr.error.mechanism"]).toBe("manual");
    expect(record.attributes["log.record.uid"]).toMatch(/^[0-9a-f-]{32,36}$/);
  });

  it("never redacts the uid, even when it matches the credit-card pattern", () => {
    // A numeric-heavy UUID whose leading groups are all digits — the default
    // credit-card redaction pattern would redact it to "[Filtered]" if the uid went
    // through redaction.
    const uid = "40000000-0000-4000-8000-000000000002";
    const spy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue(uid as ReturnType<typeof crypto.randomUUID>);
    try {
      makeClient().capture({
        error: new Error("boom"),
        mechanism: "manual",
        handled: true,
      });
      const [record] = otel.records();
      expect(record.attributes["log.record.uid"]).toBe(uid);
    } finally {
      spy.mockRestore();
    }
  });

  it("maps fatal severity", () => {
    makeClient().capture({
      error: new Error("dead"),
      mechanism: "uncaughtException",
      handled: false,
      severity: "fatal",
    });
    const [record] = otel.records();
    expect(record.severityNumber).toBe(SeverityNumber.FATAL);
    expect(record.severityText).toBe("FATAL");
  });

  it("rate-limits identical errors", () => {
    const client = makeClient({ rateLimit: { count: 5, windowMs: 60_000 } });
    const error = new Error("same");
    for (let i = 0; i < 10; i++) {
      client.capture({ error, mechanism: "manual", handled: true });
    }
    expect(otel.records()).toHaveLength(5);
  });

  it("beforeSend can mutate and drop events", () => {
    const client = makeClient({
      beforeSend: (event) => {
        if (event.message.includes("drop-me")) return null;
        event.attributes = { ...event.attributes, app: "test" };
        return event;
      },
    });
    client.capture({
      error: new Error("drop-me"),
      mechanism: "manual",
      handled: true,
    });
    client.capture({
      error: new Error("keep"),
      mechanism: "manual",
      handled: true,
    });
    const records = otel.records();
    expect(records).toHaveLength(1);
    expect(records[0].attributes.app).toBe("test");
  });

  it("redacts message and string attributes", () => {
    makeClient().capture({
      error: new Error("login failed for a@b.com"),
      mechanism: "manual",
      handled: true,
      attributes: { "url.full": "/cb?token=s3cret" },
    });
    const [record] = otel.records();
    expect(record.body).toBe("Error: login failed for [Filtered]");
    expect(record.attributes["url.full"]).toBe("/cb");
  });

  it("honors custom redaction options", () => {
    makeClient({
      redactKeys: false,
      redactPatterns: [/secret/g],
    }).capture({
      error: new Error("secret"),
      mechanism: "manual",
      handled: true,
      attributes: { "x-api-key": "keep" },
    });

    const [record] = otel.records();
    expect(record.body).toBe("Error: [Filtered]");
    expect(record.attributes["x-api-key"]).toBe("keep");
  });

  it("ignores re-entrant captures", () => {
    const client = makeClient({
      beforeSend: (event) => {
        client.capture({
          error: new Error("nested"),
          mechanism: "manual",
          handled: true,
        });
        return event;
      },
    });
    client.capture({
      error: new Error("outer"),
      mechanism: "manual",
      handled: true,
    });
    expect(otel.records()).toHaveLength(1);
  });

  it("emits the error log in the active span's trace context", () => {
    const client = makeClient();
    const tracer = trace.getTracer("test");
    tracer.startActiveSpan("request", (requestSpan) => {
      client.capture({
        error: new Error("in-trace"),
        mechanism: "manual",
        handled: true,
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
    const client = makeClient();
    trace.getTracer("test").startActiveSpan("request", (requestSpan) => {
      client.capture({
        error: new Error("boom"),
        mechanism: "manual",
        handled: true,
      });
      requestSpan.end();
    });

    const requestSpan = otel.spans().find((s) => s.name === "request");
    expect(requestSpan?.status.code).toBe(SpanStatusCode.ERROR);
    expect(requestSpan?.status.message).toBe("Error: boom");
    expect(requestSpan?.events.map((e) => e.name)).toContain("exception");
  });

  it("setLogger redirects emission to a provider's logger", () => {
    const client = makeClient();
    const emit = vi.fn();
    client.setLogger({ emit } as unknown as Parameters<Client["setLogger"]>[0]);
    client.capture({
      error: new Error("routed"),
      mechanism: "manual",
      handled: true,
    });

    expect(otel.records()).toHaveLength(0);
    expect(emit).toHaveBeenCalledOnce();
    expect(emit.mock.calls[0][0]).toMatchObject({ eventName: "exception" });
  });

  it("emits no error.context span", () => {
    makeClient().capture({
      error: new Error("bare"),
      mechanism: "manual",
      handled: true,
    });
    expect(otel.spans()).toHaveLength(0);
  });
});
