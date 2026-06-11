import { trace } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

function makeClient(options: Options = {}, runtime: "node" | "browser" = "node") {
  return new Client(options, runtime, []);
}

describe("Client.capture", () => {
  it("emits a semconv log record", () => {
    makeClient().capture({
      error: new TypeError("boom"),
      mechanism: "manual",
      handled: true,
    });
    const [record] = otel.records();
    expect(record.severityNumber).toBe(SeverityNumber.ERROR);
    expect(record.severityText).toBe("ERROR");
    expect(record.body).toBe("TypeError: boom");
    expect(record.attributes["exception.type"]).toBe("TypeError");
    expect(record.attributes["exception.message"]).toBe("boom");
    expect(record.attributes["exception.stacktrace"]).toContain("client.test.ts");
    expect(record.attributes["exception.handled"]).toBe(true);
    expect(record.attributes["exception.mechanism"]).toBe("manual");
    expect(record.attributes["error.id"]).toMatch(/^[0-9a-f-]{32,36}$/);
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
    client.capture({ error: new Error("drop-me"), mechanism: "manual", handled: true });
    client.capture({ error: new Error("keep"), mechanism: "manual", handled: true });
    const records = otel.records();
    expect(records).toHaveLength(1);
    expect(records[0].attributes.app).toBe("test");
  });

  it("scrubs message and string attributes", () => {
    makeClient().capture({
      error: new Error("login failed for a@b.com"),
      mechanism: "manual",
      handled: true,
      attributes: { "url.full": "/cb?token=s3cret" },
    });
    const [record] = otel.records();
    expect(record.body).toBe("Error: login failed for [Filtered]");
    expect(record.attributes["url.full"]).toBe("/cb?token=[Filtered]");
  });

  it("ignores re-entrant captures", () => {
    const client = makeClient({
      beforeSend: (event) => {
        client.capture({ error: new Error("nested"), mechanism: "manual", handled: true });
        return event;
      },
    });
    client.capture({ error: new Error("outer"), mechanism: "manual", handled: true });
    expect(otel.records()).toHaveLength(1);
  });

  it("emits a breadcrumb span correlated via error.id and trace context", () => {
    const client = makeClient();
    client.addBreadcrumb({ category: "console", message: "step 1" });
    client.addBreadcrumb({ category: "http", message: "GET /x 200" });
    client.capture({ error: new Error("boom"), mechanism: "manual", handled: true });

    const [record] = otel.records();
    const [span] = otel.spans();
    expect(span.name).toBe("error.context");
    expect(span.attributes["error.id"]).toBe(record.attributes["error.id"]);
    expect(span.events.map((e) => e.name)).toEqual(["step 1", "GET /x 200"]);
    expect(span.events[0].attributes?.["breadcrumb.category"]).toBe("console");
    expect(record.spanContext?.traceId).toBe(span.spanContext().traceId);
  });

  it("keeps the real trace on the record and links the breadcrumb span", () => {
    const client = makeClient();
    client.addBreadcrumb({ category: "console", message: "before" });
    const tracer = trace.getTracer("test");
    tracer.startActiveSpan("request", (requestSpan) => {
      client.capture({ error: new Error("in-trace"), mechanism: "manual", handled: true });
      requestSpan.end();
    });

    const [record] = otel.records();
    const breadcrumbSpan = otel.spans().find((s) => s.name === "error.context");
    const requestSpan = otel.spans().find((s) => s.name === "request");
    expect(record.spanContext?.traceId).toBe(requestSpan?.spanContext().traceId);
    expect(breadcrumbSpan?.links[0]?.context.traceId).toBe(
      requestSpan?.spanContext().traceId,
    );
  });

  it("filters node breadcrumbs by trace, browser includes all", () => {
    const nodeClient = makeClient({}, "node");
    nodeClient.breadcrumbs?.add({
      timestamp: Date.now(),
      category: "http",
      message: "other request",
      traceId: "0af7651916cd43dd8448eb211c80319c",
    });
    nodeClient.addBreadcrumb({ category: "console", message: "ambient" });
    nodeClient.capture({ error: new Error("x"), mechanism: "manual", handled: true });
    expect(otel.spans()[0].events.map((e) => e.name)).toEqual(["ambient"]);

    otel.reset();
    const browserClient = makeClient({}, "browser");
    browserClient.breadcrumbs?.add({
      timestamp: Date.now(),
      category: "http",
      message: "tagged",
      traceId: "0af7651916cd43dd8448eb211c80319c",
    });
    browserClient.capture({ error: new Error("y"), mechanism: "manual", handled: true });
    expect(otel.spans()[0].events.map((e) => e.name)).toEqual(["tagged"]);
  });

  it("emits no span when there are no breadcrumbs or breadcrumbs are disabled", () => {
    makeClient().capture({ error: new Error("bare"), mechanism: "manual", handled: true });
    expect(otel.spans()).toHaveLength(0);

    const disabled = makeClient({ breadcrumbs: false });
    disabled.addBreadcrumb({ category: "console", message: "ignored" });
    disabled.capture({ error: new Error("z"), mechanism: "manual", handled: true });
    expect(otel.spans()).toHaveLength(0);
  });
});
