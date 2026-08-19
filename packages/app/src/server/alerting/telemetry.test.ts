import { trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { currentTraceLink } from "@/data/alerting/trace-link";
import { setAlertSpanAttributes, withAlertJobSpan } from "./telemetry";

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
provider.register();

afterAll(async () => {
  await provider.shutdown();
});

beforeEach(() => {
  exporter.reset();
});

const finished = () => exporter.getFinishedSpans();

describe("an alerting job's span", () => {
  // Every hop is a queue hop with fan-out or unbounded delay, so a job must
  // never inherit its enqueuer's trace: one page arriving hours late would
  // otherwise hold a trace open for the whole silence window.
  it("starts its own trace instead of nesting under the enqueuer", async () => {
    const enqueuer = await withAlertJobSpan("alerts.jobs.evaluate", {}, () =>
      Promise.resolve(currentTraceLink()),
    );

    await withAlertJobSpan(
      "alerts.jobs.send_delivery",
      { traceparent: enqueuer.traceparent },
      async () => {},
    );

    const [evaluate, send] = finished();
    expect(send.parentSpanContext).toBeUndefined();
    expect(send.spanContext().traceId).not.toBe(evaluate.spanContext().traceId);
  });

  it("links back to the span that enqueued it", async () => {
    const enqueuer = await withAlertJobSpan("alerts.jobs.flush_group", {}, () =>
      Promise.resolve(currentTraceLink()),
    );

    await withAlertJobSpan(
      "alerts.jobs.send_delivery",
      { traceparent: enqueuer.traceparent },
      async () => {},
    );

    const [flush, send] = finished();
    expect(send.links).toHaveLength(1);
    expect(send.links[0].context.traceId).toBe(flush.spanContext().traceId);
    expect(send.links[0].context.spanId).toBe(flush.spanContext().spanId);
  });

  // The set-based SQL that releases a silence writes an explicit null, and
  // jobs enqueued before this shipped carry nothing at all.
  it.each([
    ["absent", undefined],
    ["null", null],
    ["malformed", "not-a-traceparent"],
  ])("runs with no link when the traceparent is %s", async (_label, value) => {
    await withAlertJobSpan(
      "alerts.jobs.process_event",
      { traceparent: value },
      async () => {},
    );

    expect(finished()[0].links).toEqual([]);
  });

  it("records the failure message on the span, not just the error status", async () => {
    await expect(
      withAlertJobSpan("alerts.jobs.evaluate", {}, async () => {
        throw new Error("clickhouse refused the query");
      }),
    ).rejects.toThrow("clickhouse refused the query");

    expect(finished()[0].status).toMatchObject({
      message: "clickhouse refused the query",
    });
  });

  // Operating a multitenant fleet means asking whose rules are slow and who
  // is starving whom. Without the tenant on the span, no trace-level question
  // has a per-customer answer, and it cannot go on a metric.
  it("names the owning tenant, so a fleet can be read one customer at a time", async () => {
    await withAlertJobSpan("alerts.jobs.evaluate", {}, async () => {
      setAlertSpanAttributes({
        tenant: "org_abc",
        slug: "payments/api-errors",
      });
    });

    expect(finished()[0].attributes["everr.alert.tenant"]).toBe("org_abc");
  });

  // An id that never arrived must be absent, not empty: a query cannot tell
  // "no episode" from "an episode whose id is the empty string".
  it("omits identity it does not have", async () => {
    await withAlertJobSpan("alerts.jobs.send_delivery", {}, async () => {
      setAlertSpanAttributes({
        slug: "payments/api-errors",
        episodeId: null,
        channelType: "slack",
      });
    });

    const { attributes } = finished()[0];
    expect(attributes["everr.alert.rule"]).toBe("payments/api-errors");
    expect(attributes["everr.alert.channel.type"]).toBe("slack");
    expect(attributes).not.toHaveProperty("everr.alert.episode_id");
  });
});

describe("a job payload's trace link", () => {
  it("carries the active span so the consumer can find it", async () => {
    const link = await withAlertJobSpan("alerts.jobs.scan", {}, () =>
      Promise.resolve(currentTraceLink()),
    );

    const [scan] = finished();
    expect(link.traceparent).toBe(
      `00-${scan.spanContext().traceId}-${scan.spanContext().spanId}-01`,
    );
  });

  it("is empty outside a span, so an enqueue never invents one", () => {
    expect(trace.getActiveSpan()).toBeUndefined();
    expect(currentTraceLink()).toEqual({});
  });
});
