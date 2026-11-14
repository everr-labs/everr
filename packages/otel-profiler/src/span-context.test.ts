import { time } from "@datadog/pprof";
import { context, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import {
  LOW_CARDINALITY_LABELS,
  ProfilingContextManager,
  ProfilingSpanProcessor,
  sampleLabels,
} from "./span-context.js";

const tracer = new BasicTracerProvider({
  spanProcessors: [new ProfilingSpanProcessor()],
}).getTracer("test");

function busy(ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end);
}

// Profiles a request whose route is only known after its child span ran, the
// way framework instrumentations set http.route.
async function profileRequest(parent = ROOT_CONTEXT) {
  const startedAt = Date.now() * 1000;
  time.start({ intervalMicros: 1_000, withContexts: true, useCPED: true });
  const ids = await tracer.startActiveSpan("GET", {}, parent, async (root) => {
    const childId = await tracer.startActiveSpan("db.query", async (child) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      busy(100);
      child.end();
      return child.spanContext().spanId;
    });
    root.setAttribute("http.route", "/orders/:id");
    root.updateName("GET /orders/:id");
    root.end();
    return { traceId: root.spanContext().traceId, childId };
  });
  const profile = time.stop(false, sampleLabels, LOW_CARDINALITY_LABELS);
  const endedAt = Date.now() * 1000;

  const text = (index: unknown) => profile.stringTable.strings[Number(index)];
  const samples = profile.sample.map((sample) =>
    Object.fromEntries(
      sample.label.map((label) => [
        text(label.key),
        label.str ? text(label.str) : Number(label.num),
      ]),
    ),
  );
  return { ...ids, samples, startedAt, endedAt };
}

describe("span labels", () => {
  beforeAll(() => {
    context.setGlobalContextManager(new ProfilingContextManager().enable());
  });
  afterAll(() => {
    context.disable();
  });

  it("labels samples in a child span with its local root's final route and name", async () => {
    const { traceId, childId, samples, startedAt, endedAt } = await profileRequest();
    const inChild = samples.filter((labels) => labels.span_id === childId);

    expect(inChild.length).toBeGreaterThan(0);
    for (const labels of inChild) {
      expect(labels).toMatchObject({
        trace_id: traceId,
        "http.route": "/orders/:id",
        "everr.root_span.name": "GET /orders/:id",
      });
      expect(labels.timestamp_unix_micros).toBeGreaterThanOrEqual(startedAt);
      expect(labels.timestamp_unix_micros).toBeLessThanOrEqual(endedAt);
    }
  });

  it("treats the first local span under a remote parent as the root", async () => {
    const remote = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: "0102030405060708090a0b0c0d0e0f10",
      spanId: "1112131415161718",
      traceFlags: 1,
      isRemote: true,
    });
    const { childId, samples } = await profileRequest(remote);
    const inChild = samples.filter((labels) => labels.span_id === childId);

    expect(inChild.length).toBeGreaterThan(0);
    expect(inChild[0]).toMatchObject({ "everr.root_span.name": "GET /orders/:id" });
  });

  it("stops charging samples to a span once the awaited span returns", async () => {
    time.start({ intervalMicros: 1_000, withContexts: true, useCPED: true });
    await tracer.startActiveSpan("GET", async (span) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      span.end();
    });
    busy(100);
    const profile = time.stop(false, sampleLabels, LOW_CARDINALITY_LABELS);

    const unlinkedWallNanos = profile.sample
      .filter((sample) => sample.label.length === 0)
      .reduce((total, sample) => total + Number(sample.value[1]), 0);
    expect(unlinkedWallNanos).toBeGreaterThan(50_000_000);
  });

  it("keeps charging a span when a context with the same span is entered", async () => {
    time.start({ intervalMicros: 1_000, withContexts: true, useCPED: true });
    const spanId = await tracer.startActiveSpan("GET", async (span) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      context.with(context.active(), () => busy(100));
      span.end();
      return span.spanContext().spanId;
    });
    const profile = time.stop(false, sampleLabels, LOW_CARDINALITY_LABELS);

    const text = (index: unknown) => profile.stringTable.strings[Number(index)];
    const linkedWallNanos = profile.sample
      .filter((sample) =>
        sample.label.some((label) => text(label.key) === "span_id" && text(label.str) === spanId),
      )
      .reduce((total, sample) => total + Number(sample.value[1]), 0);
    expect(linkedWallNanos).toBeGreaterThan(50_000_000);
  });
});
