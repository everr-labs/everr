import { fireEvent, render } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { TraceFlamegraph } from "./flamegraph";
import { buildTraceModel } from "./model";
import { computeVisualLayout } from "./rendering/compute-visual-layout";
import { getFlamegraphRowMetrics } from "./rendering/draw-utils";
import type { FlamegraphSpan } from "./rendering/types";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  undefined,
  "selected",
])("paints the opening viewport before paint and redraws on scroll (selection: %s)", (selectedSpanId) => {
  vi.stubGlobal("devicePixelRatio", 1);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);
  const roundRect = vi.fn();
  const context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    roundRect,
    fill: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillText: vi.fn(),
    measureText: () => ({ width: 1 }),
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
  const selected: FlamegraphSpan = {
    spanId: "selected",
    parentSpanId: "",
    name: "selected",
    timestamp: 0,
    durationNano: 1_000_000,
    hasError: false,
    resource: {},
    attributes: {},
    event: [],
  };
  const layout = {
    ...computeVisualLayout([]),
    visualRows: Array.from({ length: 21 }, (_, row) =>
      row === (selectedSpanId ? 20 : 0) ? [selected] : [],
    ),
    totalVisualRows: 21,
    spanToVisualRow: { selected: selectedSpanId ? 20 : 0 },
  };
  let beforePaint: unknown[][] = [];
  function OpeningFrame() {
    useLayoutEffect(() => {
      beforePaint = roundRect.mock.calls.slice();
    }, []);
    return (
      <TraceFlamegraph
        model={buildTraceModel([])}
        layout={layout}
        selectedSpanId={selectedSpanId}
        matchingIds={new Set()}
        filterActive={false}
        colorBy="service.name"
        range={{ start: 0, end: 1 }}
        onRangeChange={vi.fn()}
        onSelect={vi.fn()}
      />
    );
  }
  const view = render(<OpeningFrame />);
  const viewport = view.container.querySelector<HTMLElement>(
    '[data-slot="scroll-area-viewport"]',
  );
  if (!viewport) throw new Error("Flamegraph viewport was not rendered");
  const metrics = getFlamegraphRowMetrics(24);
  expect(viewport.scrollTop).toBe(selectedSpanId ? 430 : 0);
  expect(beforePaint).toEqual([
    [
      0,
      (selectedSpanId ? 50 : 0) + metrics.SPAN_BAR_Y_OFFSET,
      200,
      metrics.SPAN_BAR_HEIGHT,
      2,
    ],
  ]);
  roundRect.mockClear();
  viewport.scrollTop = selectedSpanId ? 460 : 10;
  fireEvent.scroll(viewport);
  expect(roundRect).toHaveBeenLastCalledWith(
    0,
    (selectedSpanId ? 20 : -10) + metrics.SPAN_BAR_Y_OFFSET,
    200,
    metrics.SPAN_BAR_HEIGHT,
    2,
  );
});
