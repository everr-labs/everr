import type { Tracer } from "@opentelemetry/api";
import { afterEach, describe, expect, it } from "vitest";
import type { WebSDK } from "../client.js";
import {
  attrs,
  type OtlpBatch,
  type OtlpSpan,
  startClient,
} from "../test-kit.js";

// The tracer that ctx.tracer gives to an instrumentation. It is a small
// @opentelemetry/api Tracer on the span pipeline of the SDK. These tests use it
// as an instrumentation uses it, through a custom instrumentation in the WebSDK.
// They examine the output in the traces batches.

let client: WebSDK | undefined;
let batches: OtlpBatch[];
let tracer: Tracer;

function start(): void {
  [client, batches] = startClient({
    instrumentations: [
      (ctx) => {
        tracer = ctx.tracer;
      },
    ],
  });
}

async function spans(): Promise<OtlpSpan[]> {
  await client?.flush();
  return batches.flatMap((b) => b.spans);
}

afterEach(async () => {
  await client?.shutdown();
  client = undefined;
});

describe("instrumentation tracer", () => {
  it("parents a span to the active span, from startActiveSpan until its end", async () => {
    start();
    const parent = tracer.startActiveSpan("pageLoad", (span) => span);
    // The function returned. In OTel the span is then not active. In this
    // SDK, it is active until its end.
    const child = tracer.startSpan("work");
    child.end();
    parent.end();
    const after = tracer.startSpan("later");
    after.end();
    const wire = await spans();
    const by = (name: string) =>
      wire.find((span) => span.name === name) as OtlpSpan;
    const childWire = by("work");
    const parentWire = by("pageLoad");
    const afterWire = by("later");
    expect(parentWire.name).toBe("pageLoad");
    expect(parentWire.parentSpanId).toBeUndefined();
    expect(childWire.traceId).toBe(parentWire.traceId);
    expect(childWire.spanId).not.toBe(parentWire.spanId);
    expect(childWire.parentSpanId).toBe(parentWire.spanId);
    expect(afterWire.parentSpanId).toBeUndefined();
    expect(afterWire.traceId).not.toBe(parentWire.traceId);
  });

  it("stacks the active spans", async () => {
    start();
    const outer = tracer.startActiveSpan("outer", (span) => span);
    const inner = tracer.startActiveSpan(
      "inner",
      { attributes: {} },
      (span) => span,
    );
    tracer.startSpan("in-inner").end();
    inner.end();
    tracer.startSpan("in-outer").end();
    outer.end();
    const wire = await spans();
    const by = (name: string) => wire.find((s) => s.name === name) as OtlpSpan;
    expect(by("inner").parentSpanId).toBe(by("outer").spanId);
    expect(by("in-inner").parentSpanId).toBe(by("inner").spanId);
    expect(by("in-outer").parentSpanId).toBe(by("outer").spanId);
    expect(by("in-outer").traceId).toBe(by("outer").traceId);
  });

  it("drops an active span that ends before its child", async () => {
    // The parent ends first. The child is then the only active span, and a
    // new span is its child. When the child ends, no span is active.
    start();
    const outer = tracer.startActiveSpan("outer", (span) => span);
    const inner = tracer.startActiveSpan("inner", (span) => span);
    outer.end();
    tracer.startSpan("in-inner").end();
    inner.end();
    tracer.startSpan("alone").end();
    const wire = await spans();
    const by = (name: string) => wire.find((s) => s.name === name) as OtlpSpan;
    expect(by("in-inner").parentSpanId).toBe(by("inner").spanId);
    expect(by("alone").parentSpanId).toBeUndefined();
  });

  it("accepts no attribute after the end", async () => {
    start();
    const span = tracer.startSpan("work", { attributes: { a: 1 } });
    span.end();
    span.setAttribute("late", true);
    span.setAttributes({ later: true });
    const [wire] = await spans();
    const a = attrs(wire);
    expect(a.a).toBe("1");
    expect(a.late).toBeUndefined();
    expect(a.later).toBeUndefined();
  });

  it("returns the value of the function and ends nothing by itself", async () => {
    start();
    const value = tracer.startActiveSpan("work", (span) => {
      span.end();
      return 42;
    });
    expect(value).toBe(42);
    expect(await spans()).toHaveLength(1);
  });

  it("ships an ended span with its own sampled trace, CLIENT kind, and attributes", async () => {
    start();
    const span = tracer.startSpan("work", {
      attributes: { "everr.step": "one" },
    });
    span.setAttribute("everr.count", 2);
    span.setAttributes({ "everr.flag": true });
    span.end();
    const [wire] = await spans();
    expect(wire.name).toBe("work");
    expect(wire.kind).toBe(3); // CLIENT
    expect(wire.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(wire.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(wire.parentSpanId).toBeUndefined();
    const a = attrs(wire);
    expect(a["everr.step"]).toBe("one");
    expect(a["everr.count"]).toBe("2");
    expect(a["everr.flag"]).toBe(true);
    expect(wire.status).toBeUndefined();
  });

  it("exposes the minted ids via spanContext for propagation", () => {
    start();
    const span = tracer.startSpan("propagate");
    const ctx = span.spanContext();
    expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(ctx.traceFlags).toBe(1);
    span.end();
  });

  it("accepts and drops events and links, chaining like the API", async () => {
    start();
    const span = tracer.startSpan("chained");
    expect(span.addEvent("ignored")).toBe(span);
    expect(span.addLink({ context: span.spanContext() })).toBe(span);
    expect(span.addLinks([{ context: span.spanContext() }])).toBe(span);
    span.end();
    const [wire] = await spans();
    expect(wire.name).toBe("chained");
  });

  it("updateName renames, setStatus ERROR marks, and a later OK clears", async () => {
    start();
    const errored = tracer.startSpan("old-name");
    errored.updateName("new-name");
    errored.setStatus({ code: 2 });
    errored.end();
    const cleared = tracer.startSpan("cleared");
    cleared.setStatus({ code: 2 });
    cleared.setStatus({ code: 1 }); // OK overrides the earlier ERROR
    cleared.end();
    const wire = await spans();
    expect(wire[0].name).toBe("new-name");
    expect(wire[0].status.code).toBe(2);
    expect(wire[1].status).toBeUndefined();
  });

  it("records only while un-ended, and a second end ships nothing", async () => {
    start();
    const span = tracer.startSpan("once");
    expect(span.isRecording()).toBe(true);
    span.end();
    expect(span.isRecording()).toBe(false);
    span.end();
    expect(await spans()).toHaveLength(1);
  });

  it("flattens recordException onto exception.* attributes per shape", async () => {
    start();
    const fromError = tracer.startSpan("from-error");
    fromError.recordException(new RangeError("out of range"));
    fromError.end();
    const fromString = tracer.startSpan("from-string");
    fromString.recordException("plain failure");
    fromString.end();
    const fromBare = tracer.startSpan("from-bare");
    fromBare.recordException({} as Error); // no name, no message
    fromBare.end();
    const wire = await spans();
    expect(attrs(wire[0])["exception.type"]).toBe("RangeError");
    expect(attrs(wire[0])["exception.message"]).toBe("out of range");
    expect(attrs(wire[1])["exception.type"]).toBe("Error");
    expect(attrs(wire[1])["exception.message"]).toBe("plain failure");
    expect(attrs(wire[2])["exception.type"]).toBe("Error");
    expect(attrs(wire[2])["exception.message"]).toBeUndefined();
  });

  it("honors normalized epoch-millisecond times", async () => {
    start();
    const explicit = tracer.startSpan("explicit", {
      startTime: 1_724_976_000_123,
    });
    explicit.end(1_725_004_801_456);
    const wire = await spans();
    expect(wire[0].startTimeUnixNano).toBe("1724976000123000000");
    expect(wire[0].endTimeUnixNano).toBe("1725004801456000000");
  });

  it("startActiveSpan runs the callback with the span, options collapsed", async () => {
    start();
    const plain = tracer.startActiveSpan("active-plain", (span) => {
      span.end();
      return "done";
    });
    expect(plain).toBe("done");
    tracer.startActiveSpan(
      "active-options",
      { attributes: { "everr.mode": "opts" } },
      (span) => span.end(),
    );
    const wire = await spans();
    expect(wire[0].name).toBe("active-plain");
    expect(wire[1].name).toBe("active-options");
    expect(attrs(wire[1])["everr.mode"]).toBe("opts");
  });
});
