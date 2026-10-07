import { expect, it, vi } from "vitest";
import { getFlamegraphRowMetrics } from "./draw-utils";
import { drawConnectorLines } from "./use-flamegraph-draw";

function context() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  };
}

it.each([
  "parent",
  "child",
])("connects separated rows when the %s endpoint is focused", (focusedId) => {
  const ctx = context();
  drawConnectorLines({
    ctx: ctx as unknown as CanvasRenderingContext2D,
    connectors: [
      {
        parentRow: 0,
        childRow: 2,
        timestampMs: 1050,
        parentSpanId: "parent",
        childSpanId: "child",
      },
    ],
    scrollTop: 0,
    viewStartTs: 1000,
    timeSpan: 100,
    cssWidth: 100,
    viewportHeight: 100,
    metrics: getFlamegraphRowMetrics(24),
    colorBy: "service.name",
    focusedSpanIds: new Set([focusedId]),
  });
  expect(ctx.moveTo).toHaveBeenCalledWith(50, 23);
  expect(ctx.lineTo).toHaveBeenCalledWith(50, 49);
});

it("does not pin an off-screen parent connection to the left edge when zoomed", () => {
  const ctx = context();
  drawConnectorLines({
    ctx: ctx as unknown as CanvasRenderingContext2D,
    connectors: [
      {
        parentRow: 0,
        childRow: 2,
        timestampMs: 995,
        parentSpanId: "parent",
        childSpanId: "child",
      },
    ],
    scrollTop: 0,
    viewStartTs: 1000,
    timeSpan: 1000,
    cssWidth: 100,
    viewportHeight: 100,
    metrics: getFlamegraphRowMetrics(24),
    colorBy: "service.name",
  });
  expect(ctx.stroke).not.toHaveBeenCalled();
});

it("keeps parent connection guides hidden unless an endpoint is focused", () => {
  const ctx = context();
  drawConnectorLines({
    ctx: ctx as unknown as CanvasRenderingContext2D,
    connectors: [
      {
        parentRow: 0,
        childRow: 2,
        timestampMs: 1050,
        parentSpanId: "parent",
        childSpanId: "child",
      },
    ],
    scrollTop: 0,
    viewStartTs: 1000,
    timeSpan: 100,
    cssWidth: 100,
    viewportHeight: 100,
    metrics: getFlamegraphRowMetrics(24),
    colorBy: "service.name",
    focusedSpanIds: new Set(["unrelated"]),
  });
  expect(ctx.stroke).not.toHaveBeenCalled();
});
