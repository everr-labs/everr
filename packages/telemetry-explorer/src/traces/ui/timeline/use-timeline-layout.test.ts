import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Span } from "../../data/types";
import { useTimelineLayout } from "./use-timeline-layout";

function span(overrides: Partial<Span> & { spanId: string }): Span {
  return {
    traceId: "t1",
    parentSpanId: "",
    spanName: overrides.spanId,
    serviceName: "svc",
    serviceNamespace: "",
    timestamp: "2026-05-20 12:00:00.000",
    timestampNs: "1000",
    duration: "100",
    statusCode: "Ok",
    spanKind: "",
    spanAttributes: {},
    resourceAttributes: {},
    events: [],
    links: [],
    ...overrides,
  };
}

describe("useTimelineLayout", () => {
  it("orders a single-root trace by depth", () => {
    const spans: Span[] = [
      span({ spanId: "root", timestampNs: "1000" }),
      span({ spanId: "child", parentSpanId: "root", timestampNs: "1100" }),
      span({ spanId: "grand", parentSpanId: "child", timestampNs: "1200" }),
    ];
    const { result } = renderHook(() => useTimelineLayout(spans));

    expect(result.current.rows.map((r) => r.span.spanId)).toEqual([
      "root",
      "child",
      "grand",
    ]);
    expect(result.current.rows.map((r) => r.depth)).toEqual([0, 1, 2]);
  });

  it("renders multiple roots sorted by (timestampNs, spanId)", () => {
    const spans: Span[] = [
      span({ spanId: "b", timestampNs: "2000" }),
      span({ spanId: "a", timestampNs: "1000" }),
      span({ spanId: "c", timestampNs: "2000" }),
      span({ spanId: "a-child", parentSpanId: "a", timestampNs: "1500" }),
    ];
    const { result } = renderHook(() => useTimelineLayout(spans));

    expect(result.current.rows.map((r) => r.span.spanId)).toEqual([
      "a",
      "a-child",
      "b",
      "c",
    ]);
  });

  it("treats spans whose parent is missing from the set as orphan roots", () => {
    const spans: Span[] = [
      span({ spanId: "a", parentSpanId: "missing-1", timestampNs: "1000" }),
      span({
        spanId: "a-child",
        parentSpanId: "a",
        timestampNs: "1100",
      }),
      span({ spanId: "b", parentSpanId: "missing-2", timestampNs: "2000" }),
    ];
    const { result } = renderHook(() => useTimelineLayout(spans));

    const roots = result.current.rows.filter((r) => r.depth === 0);
    expect(roots.map((r) => r.span.spanId)).toEqual(["a", "b"]);
    expect(result.current.rows.map((r) => r.span.spanId)).toEqual([
      "a",
      "a-child",
      "b",
    ]);
  });

  it("collapse hides descendants but keeps the ancestor", () => {
    const spans: Span[] = [
      span({ spanId: "root", timestampNs: "1000" }),
      span({ spanId: "child", parentSpanId: "root", timestampNs: "1100" }),
      span({ spanId: "grand", parentSpanId: "child", timestampNs: "1200" }),
    ];
    const { result } = renderHook(() => useTimelineLayout(spans));

    act(() => {
      result.current.toggleCollapse("root");
    });

    expect(result.current.rows.map((r) => r.span.spanId)).toEqual(["root"]);
    expect(result.current.rows[0]?.collapsed).toBe(true);
    expect(result.current.rows[0]?.hasChildren).toBe(true);
  });

  it("includes zero-duration spans in traceEndNs", () => {
    const spans: Span[] = [
      span({ spanId: "root", timestampNs: "1000", duration: "500" }),
      span({
        spanId: "tail",
        parentSpanId: "root",
        timestampNs: "2000",
        duration: "0",
      }),
    ];
    const { result } = renderHook(() => useTimelineLayout(spans));

    expect(result.current.traceStartNs).toBe(1000n);
    expect(result.current.traceEndNs).toBe(2000n);
  });

  it("sorts using timestampNs (bigint) not the timestamp string", () => {
    const spans: Span[] = [
      span({
        spanId: "later",
        timestamp: "2026-05-20 12:00:00.000",
        timestampNs: "9000000000",
      }),
      span({
        spanId: "earlier",
        timestamp: "2026-05-20 12:00:00.000",
        timestampNs: "1000000000",
      }),
    ];
    const { result } = renderHook(() => useTimelineLayout(spans));

    expect(result.current.rows.map((r) => r.span.spanId)).toEqual([
      "earlier",
      "later",
    ]);
  });
});
