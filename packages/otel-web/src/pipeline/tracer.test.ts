import type { Tracer } from "@opentelemetry/api";
import { afterEach, describe, expect, it } from "vitest";
import type { WebSDK } from "../client.js";
import { logger } from "../logger.js";
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
    const parent = tracer.startActiveSpan("parent", (span) => span);
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
    const parentWire = by("parent");
    const afterWire = by("later");
    expect(parentWire.name).toBe("parent");
    expect(parentWire.parentSpanId).toBeUndefined();
    expect(childWire.traceId).toBe(parentWire.traceId);
    expect(childWire.spanId).not.toBe(parentWire.spanId);
    expect(childWire.parentSpanId).toBe(parentWire.spanId);
    expect(afterWire.parentSpanId).toBeUndefined();
    expect(afterWire.traceId).not.toBe(parentWire.traceId);
  });

  it("stamps a log with the active span, and with none after that span ends", async () => {
    start();
    logger.info("outside");
    const parent = tracer.startActiveSpan("parent", (span) => span);
    logger.info("in parent");
    const child = tracer.startActiveSpan("child", (span) => span);
    logger.info("in child");
    tracer.startSpan("idle").end();
    logger.info("still child");
    child.end();
    logger.info("back in parent");
    parent.end();
    logger.info("after");
    await client?.flush();
    const wire = batches.flatMap((batch) => batch.spans);
    const logs = batches.flatMap((batch) => batch.records);
    const span = (name: string) => wire.find((item) => item.name === name);
    const log = (body: string) =>
      logs.find(
        (record) =>
          (record.body as { stringValue?: string } | undefined)?.stringValue ===
          body,
      );
    const parentSpan = span("parent");
    const childSpan = span("child");
    expect(log("outside")?.traceId).toBeUndefined();
    expect(log("in parent")).toMatchObject({
      traceId: parentSpan?.traceId,
      spanId: parentSpan?.spanId,
      flags: 1,
    });
    expect(log("in child")).toMatchObject({
      traceId: childSpan?.traceId,
      spanId: childSpan?.spanId,
      flags: 1,
    });
    expect(log("still child")?.spanId).toBe(childSpan?.spanId);
    expect(log("back in parent")?.spanId).toBe(parentSpan?.spanId);
    expect(log("after")?.traceId).toBeUndefined();
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

  it("ships an ended span with its own sampled trace, INTERNAL kind, and attributes", async () => {
    start();
    const span = tracer.startSpan("work", {
      attributes: { "everr.step": "one" },
    });
    span.setAttribute("everr.count", 2);
    span.setAttributes({ "everr.flag": true });
    span.end();
    const [wire] = await spans();
    expect(wire.name).toBe("work");
    expect(wire.kind).toBe(1); // INTERNAL
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

  it("records links and ignores an invalid span context", async () => {
    start();
    const other = tracer.startSpan("other");
    const span = tracer.startSpan("chained", {
      links: [
        {
          context: other.spanContext(),
          attributes: { "everr.link": "cause" },
        },
      ],
    });
    expect(span.addEvent("ignored")).toBe(span);
    expect(
      span.addLink({
        context: {
          traceId: "0".repeat(32),
          spanId: "0".repeat(16),
          traceFlags: 1,
        },
      }),
    ).toBe(span);
    span.end();
    other.end();
    const wire = await spans();
    const chained = wire.find((item) => item.name === "chained") as OtlpSpan;
    expect(chained.links).toEqual([
      {
        traceId: other.spanContext().traceId,
        spanId: other.spanContext().spanId,
        flags: 1,
        attributes: [{ key: "everr.link", value: { stringValue: "cause" } }],
      },
    ]);
  });

  it("updateName renames, OK sticks over ERROR, and the message stays on ERROR", async () => {
    start();
    const errored = tracer.startSpan("old-name");
    errored.updateName("new-name");
    errored.setStatus({ code: 2, message: "failed" });
    errored.setStatus({ code: 0, message: "unset" });
    errored.end();
    const cleared = tracer.startSpan("cleared");
    cleared.setStatus({ code: 2, message: "first" });
    cleared.setStatus({ code: 1 });
    cleared.setStatus({ code: 2, message: "later" });
    cleared.end();
    const wire = await spans();
    expect(wire[0].name).toBe("new-name");
    expect(wire[0].status).toEqual({ code: 2, message: "failed" });
    expect(wire[1].status).toEqual({ code: 1 });
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

  it("records nothing from recordException", async () => {
    start();
    const span = tracer.startSpan("from-error");
    span.recordException(new RangeError("out of range"));
    span.recordException("plain failure");
    span.end();
    const [wire] = await spans();
    expect(attrs(wire)["exception.type"]).toBeUndefined();
    expect(attrs(wire)["exception.message"]).toBeUndefined();
  });

  it("honors epoch milliseconds, a Date, and an HrTime", async () => {
    start();
    const explicit = tracer.startSpan("explicit", {
      startTime: 1_724_976_000_123,
    });
    explicit.end(1_725_004_801_456);
    const fromDate = tracer.startSpan("from-date", {
      startTime: new Date(1_724_976_000_123),
    });
    fromDate.end(new Date(1_725_004_801_456));
    const fromHr = tracer.startSpan("from-hr", {
      startTime: [1_724_976_000, 123_000_000],
    });
    fromHr.end([1_725_004_801, 456_000_000]);
    const wire = await spans();
    expect(wire.map((span) => span.startTimeUnixNano)).toEqual([
      "1724976000123000000",
      "1724976000123000000",
      "1724976000123000000",
    ]);
    expect(wire.map((span) => span.endTimeUnixNano)).toEqual([
      "1725004801456000000",
      "1725004801456000000",
      "1725004801456000000",
    ]);
  });

  it("uses the current time when the timestamp is not one of the three forms", async () => {
    start();
    const now = 1_700_000_000_000;
    const dateNow = Date.now;
    Date.now = () => now;
    try {
      const span = tracer.startSpan("now", { startTime: "nope" as never });
      span.end("later" as never);
    } finally {
      Date.now = dateNow;
    }
    const [wire] = await spans();
    expect(wire.startTimeUnixNano).toBe("1700000000000000000");
    expect(wire.endTimeUnixNano).toBe("1700000000000000000");
  });

  it("root: true starts a new trace and still parents later spans", async () => {
    start();
    const parent = tracer.startActiveSpan("parent", (span) => span);
    const rooted = tracer.startSpan("rooted", { root: true });
    rooted.end();
    parent.end();
    const activeRoot = tracer.startActiveSpan(
      "active-root",
      { root: true },
      (span) => span,
    );
    tracer.startSpan("child").end();
    activeRoot.end();
    const wire = await spans();
    const by = (name: string) =>
      wire.find((span) => span.name === name) as OtlpSpan;
    expect(by("rooted").parentSpanId).toBeUndefined();
    expect(by("rooted").traceId).not.toBe(by("parent").traceId);
    expect(by("child").parentSpanId).toBe(by("active-root").spanId);
    expect(by("child").traceId).toBe(by("active-root").traceId);
  });

  it("records array attributes", async () => {
    start();
    const span = tracer.startSpan("arrays", {
      attributes: {
        "everr.tags": ["a", null, "b"] as never,
        "everr.mixed": ["a", 1] as never,
        "everr.empty": [],
      },
    });
    span.setAttribute("everr.flags", [true, false]);
    span.end();
    const [wire] = await spans();
    const value = (key: string) =>
      wire.attributes.find((attribute) => attribute.key === key)?.value;
    expect(value("everr.tags")).toEqual({
      arrayValue: { values: [{ stringValue: "a" }, { stringValue: "b" }] },
    });
    expect(value("everr.flags")).toEqual({
      arrayValue: { values: [{ boolValue: true }, { boolValue: false }] },
    });
    expect(value("everr.empty")).toEqual({ arrayValue: { values: [] } });
    expect(value("everr.mixed")).toEqual({
      arrayValue: { values: [{ stringValue: "a" }, { intValue: "1" }] },
    });
  });

  it("ignores name, status, and link changes after end", async () => {
    start();
    const span = tracer.startSpan("frozen");
    const other = tracer.startSpan("other");
    span.end();
    span.updateName("renamed");
    span.setStatus({ code: 2, message: "late" });
    span.addLink({ context: other.spanContext() });
    other.end();
    const wire = await spans();
    const frozen = wire.find((item) => item.name === "frozen") as OtlpSpan;
    expect(wire.map((item) => item.name)).toEqual(["frozen", "other"]);
    expect(frozen.status).toBeUndefined();
    expect(frozen.links).toBeUndefined();
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
