import type { Tracer } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tracer, WebSDK } from "./index.js";
import { attrs, type OtlpSpan, startClient } from "./test-kit.js";

const clients: WebSDK[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.shutdown();
  vi.unstubAllGlobals();
});

describe("public tracer", () => {
  it("runs callbacks without recording before initialization", async () => {
    const value = await tracer.startActiveSpan("before init", async (span) => {
      expect(span.isRecording()).toBe(false);
      expect(span.spanContext().traceFlags).toBe(0);
      span.setAttribute("everr.step", "prepare").end();
      return 42;
    });
    expect(value).toBe(42);
  });

  it("shares active parents with instrumentations across await and emits custom INTERNAL segments", async () => {
    let instrumentationTracer!: Tracer;
    const [client, batches] = startClient({
      instrumentations: [
        (ctx) => {
          instrumentationTracer = ctx.tracer;
        },
      ],
      beforeSend: (event) => {
        event.attributes["everr.filtered"] = true;
        return event;
      },
    });
    clients.push(client);
    const load = instrumentationTracer.startActiveSpan(
      "pageLoad",
      (span) => span,
    );
    const value = await tracer.startActiveSpan("checkout", async (parent) => {
      try {
        await Promise.resolve();
        const child = tracer.startSpan("prepare checkout", {
          startTime: 1_789_568_000_000,
          kind: undefined,
          attributes: { "everr.checkout.step": "prepare" },
        });
        child.end(1_789_568_000_020);
        instrumentationTracer.startSpan("GET /checkout").end();
        return "done";
      } finally {
        parent.end();
      }
    });
    load.end();
    tracer.startSpan("later").end();
    await client.flush();
    const spans = batches.flatMap((batch) => batch.spans);
    const byName = (name: string) =>
      spans.find((span) => span.name === name) as OtlpSpan;
    const parent = byName("checkout");
    const child = byName("prepare checkout");
    expect(child.kind).toBe(1);
    expect(value).toBe("done");
    expect(parent.kind).toBe(1); // OTLP INTERNAL
    expect(parent.parentSpanId).toBe(byName("pageLoad").spanId);
    expect(child.parentSpanId).toBe(parent.spanId);
    expect(child.traceId).toBe(parent.traceId);
    expect(child.endTimeUnixNano).toBe("1789568000020000000");
    expect(attrs(child)).toMatchObject({
      "everr.checkout.step": "prepare",
      "everr.filtered": true,
      "session.id": expect.any(String),
    });
    expect(byName("GET /checkout").parentSpanId).toBe(parent.spanId);
    expect(byName("GET /checkout").kind).toBe(3);
    expect(byName("later").parentSpanId).toBeUndefined();
  });

  it("preserves explicit kinds and lets callers close failed async segments", async () => {
    const [client, batches] = startClient({ instrumentations: [] });
    clients.push(client);
    const error = new Error("checkout failed");
    await expect(
      tracer.startActiveSpan("checkout", { kind: 2 }, async (span) => {
        try {
          await Promise.reject(error);
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({ code: 2 });
          throw error;
        } finally {
          span.end();
        }
      }),
    ).rejects.toBe(error);
    tracer.startSpan("after failure").end();
    await client.flush();
    const [failed, after] = batches.flatMap((batch) => batch.spans);
    expect(failed.kind).toBe(3);
    expect(failed.status).toEqual({ code: 2 });
    expect(attrs(failed)["exception.message"]).toBe("checkout failed");
    expect(after.parentSpanId).toBeUndefined();
  });

  it("follows SDK replacement and ignores an older SDK's shutdown", async () => {
    const cached = tracer;
    const [first, firstBatches] = startClient({ instrumentations: [] });
    const [second, secondBatches] = startClient({ instrumentations: [] });
    clients.push(first, second);
    await first.shutdown();
    cached.startSpan("new SDK").end();
    await second.flush();
    expect(firstBatches.flatMap((batch) => batch.spans)).toHaveLength(0);
    expect(
      secondBatches.flatMap((batch) => batch.spans).map((span) => span.name),
    ).toEqual(["new SDK"]);
    await second.shutdown();
    expect(cached.startSpan("after shutdown").isRecording()).toBe(false);
  });

  it("does not record or send for a keyless production SDK", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const client = new WebSDK({ serviceName: "inert" });
    clients.push(client);
    tracer.startActiveSpan("inert", (span) => {
      expect(span.isRecording()).toBe(false);
      span.end();
    });
    await client.flush();
    expect(fetch).not.toHaveBeenCalled();
  });
});
