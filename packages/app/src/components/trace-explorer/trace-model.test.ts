import type { Span } from "@everr/telemetry-explorer/traces";
import { describe, expect, it } from "vitest";
import {
  getAncestorSpanIds,
  getVisibleSpans,
} from "./rendering/waterfall-utils";
import { buildTraceModel, matchesSpan } from "./trace-model";

const start = 1_790_251_200_000_000_000n;
function span(
  id: string,
  parent = "",
  offset = 0n,
  duration = 1_000_000n,
): Span {
  return {
    traceId: "trace",
    spanId: id,
    parentSpanId: parent,
    spanName: id,
    serviceName: "api",
    serviceNamespace: "",
    timestamp: "2026-09-24 12:00:00.000000000",
    timestampNs: String(start + offset),
    duration: String(duration),
    statusCode: "Unset",
    spanKind: "Internal",
    spanAttributes: {},
    resourceAttributes: {},
    events: [],
    links: [],
  };
}

describe("Trace model", () => {
  it("keeps nanosecond offsets at modern epoch timestamps", () => {
    const model = buildTraceModel([span("child", "root", 1n), span("root")]);
    expect(model.byId.get("child")?.timestamp).toBe(0.000001);
    expect(model.waterfall.map((s) => s.spanId)).toEqual(["root", "child"]);
  });

  it("keeps orphan spans visible and breaks cycles without dropping spans", () => {
    const model = buildTraceModel([
      span("orphan", "missing"),
      span("a", "b"),
      span("b", "a"),
      span("self", "self"),
    ]);
    expect(model.missingParents).toBe(1);
    expect(new Set(model.waterfall.map((s) => s.spanId))).toEqual(
      new Set(["orphan", "a", "b", "self"]),
    );
    expect(Object.keys(model.layout.spanToVisualRow)).toHaveLength(4);
    expect(getAncestorSpanIds(model.waterfall, "a").size).toBeLessThan(2);
  });

  it("places overlapping siblings in separate rows and preserves parent adjacency", () => {
    const model = buildTraceModel([
      span("root", "", 0n, 20_000_000n),
      span("a", "root", 1_000_000n, 10_000_000n),
      span("b", "root", 2_000_000n, 10_000_000n),
    ]);
    expect(model.layout.spanToVisualRow.a).not.toBe(
      model.layout.spanToVisualRow.b,
    );
    expect(model.layout.spanToVisualRow.a).toBeGreaterThan(
      model.layout.spanToVisualRow.root,
    );
    expect(model.layout.spanToVisualRow.b).toBeGreaterThan(
      model.layout.spanToVisualRow.root,
    );
  });

  it("collapsing a subtree retains its siblings and expands ancestors for cross-view selection", () => {
    const model = buildTraceModel([
      span("root"),
      span("a", "root"),
      span("grandchild", "a"),
      span("b", "root"),
    ]);
    expect(
      getVisibleSpans(model.waterfall, new Set(["root"])).map((s) => s.spanId),
    ).toEqual(["root", "a", "b"]);
    const ancestors = getAncestorSpanIds(model.waterfall, "grandchild");
    expect(
      getVisibleSpans(model.waterfall, ancestors).map((s) => s.spanId),
    ).toContain("grandchild");
  });

  it("converts event timestamps without discarding sub-millisecond precision", () => {
    const root = span("root");
    root.timestampNs = "1790251200000000000";
    root.events = [
      {
        name: "exception",
        timestamp: "2026-09-24 12:00:00.000000001",
        attributes: { "exception.type": "Error" },
      },
    ];
    const event = buildTraceModel([root]).byId.get("root")?.event[0];
    expect(event?.timeUnixNano).toBe(1);
    expect(event?.isError).toBe(true);
  });

  it("filters using current OTel attributes, text, and span status together", () => {
    const request = span("GET /checkout");
    request.spanAttributes = {
      "http.request.method": "GET",
      "http.response.status_code": "503",
    };
    request.statusCode = "Error";
    const node = buildTraceModel([request]).waterfall[0];
    expect(
      matchesSpan(node, "http.response.status_code=503", "HTTP", true),
    ).toBe(true);
    expect(matchesSpan(node, "200", "HTTP", true)).toBe(false);
    expect(matchesSpan(node, "", "Database", false)).toBe(false);
  });

  it("packs a wide group of non-overlapping siblings without inflating row count", () => {
    const model = buildTraceModel([
      span("root", "", 0n, 600_000_000n),
      ...Array.from({ length: 550 }, (_, i) =>
        span(`child-${i}`, "root", BigInt(i) * 1_000_000n),
      ),
    ]);
    expect(model.waterfall).toHaveLength(551);
    expect(model.layout.totalVisualRows).toBe(2);
  });
});
