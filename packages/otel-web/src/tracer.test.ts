import type { Tracer } from "@opentelemetry/api";
import { afterEach, describe, expect, it } from "vitest";
import type { WebSDK } from "./client.js";
import {
  attrs,
  type OtlpBatch,
  type OtlpSpan,
  startClient,
} from "./test-kit.js";

// The tracer handed to instrumentations via ctx.tracer: a minimal @opentelemetry/api
// Tracer over the SDK's span pipeline. Exercised the way an instrumentation would,
// through a custom instrumentation composed into the WebSDK, with the wire output
// asserted on the traces batches.

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

  it("honors epoch-millis start/end times and falls back to now otherwise", async () => {
    start();
    const explicit = tracer.startSpan("explicit", { startTime: 1_000 });
    explicit.end(2_000);
    const fallback = tracer.startSpan("fallback", { startTime: new Date() });
    fallback.end(new Date());
    const wire = await spans();
    expect(wire[0].startTimeUnixNano).toBe("1000000000");
    expect(wire[0].endTimeUnixNano).toBe("2000000000");
    // Date inputs fall back to now: on or after the explicit test times.
    expect(Number(wire[1].startTimeUnixNano)).toBeGreaterThan(2_000_000_000);
    expect(Number(wire[1].endTimeUnixNano)).toBeGreaterThanOrEqual(
      Number(wire[1].startTimeUnixNano),
    );
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
