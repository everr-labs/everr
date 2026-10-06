import { expect, it, vi } from "vitest";
import { drawSpanBar, getFlamegraphRowMetrics } from "./draw-utils";
import type { EventRect, FlamegraphSpan, SpanRect } from "./types";

it("keeps event markers at their actual time when a span is clipped by zoom", () => {
  const ctx = {
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillText: vi.fn(),
    measureText: () => ({ width: 1 }),
  } as unknown as CanvasRenderingContext2D;
  const span: FlamegraphSpan = {
    spanId: "span",
    parentSpanId: "",
    name: "request",
    timestamp: 0,
    durationNano: 1_000_000,
    hasError: false,
    attributes: {},
    resource: {},
    event: [
      {
        name: "visible",
        offsetNs: 300_000,
        attributeMap: {},
        isError: false,
      },
      {
        name: "outside",
        offsetNs: 100_000,
        attributeMap: {},
        isError: false,
      },
    ],
  };
  const events: EventRect[] = [];
  const spans: SpanRect[] = [];
  drawSpanBar({
    ctx,
    span,
    x: 0,
    y: 0,
    width: 100,
    levelIndex: 0,
    spanRectsArray: spans,
    eventRectsArray: events,
    color: "#23E0E8",
    metrics: getFlamegraphRowMetrics(24),
    viewStartTs: 0.2,
    timeSpan: 0.2,
    cssWidth: 100,
  });
  expect(events).toHaveLength(1);
  expect(events[0].event.name).toBe("visible");
  expect(events[0].cx).toBeCloseTo(50);
});
