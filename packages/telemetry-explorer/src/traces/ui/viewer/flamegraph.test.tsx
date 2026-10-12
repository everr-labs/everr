import { fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TraceFlamegraph } from "./flamegraph";
import { buildTraceModel } from "./model";
import { computeVisualLayout } from "./rendering/compute-visual-layout";
import type { SpanRect } from "./rendering/types";

const mocks = vi.hoisted(() => ({ draw: vi.fn(), rects: [] as SpanRect[] }));
vi.mock("./rendering/use-flamegraph-draw", () => ({
  useFlamegraphDraw: ({
    spanRectsRef,
  }: {
    spanRectsRef: { current: SpanRect[] };
  }) => {
    spanRectsRef.current = mocks.rects;
    return mocks.draw;
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mocks.rects = [];
});

it.each([
  [undefined, "external"],
  ["external", undefined],
])("preserves pending clicks across layout changes and clears them on competing selection (%s to %s)", (initialSelection, competingSelection) => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  const props = {
    model: buildTraceModel([]),
    layout: {
      ...computeVisualLayout([]),
      spanToVisualRow: { clicked: 2, external: 20 },
    },
    matchingIds: new Set<string>(),
    filterActive: false,
    colorBy: "service.name",
    range: { start: 0, end: 1000 },
    onRangeChange: vi.fn(),
    onSelect: vi.fn(),
  };
  mocks.rects = [
    {
      span: {
        spanId: "clicked",
        parentSpanId: "",
        name: "clicked",
        timestamp: 0,
        durationNano: 1000,
        hasError: false,
        resource: {},
        attributes: {},
        event: [],
      },
      x: 0,
      y: 0,
      width: 100,
      height: 12,
      level: 2,
    },
  ];
  const view = render(<TraceFlamegraph {...props} />);
  const canvas = view.getByRole("img");
  const viewport = view.container.querySelector<HTMLElement>(
    '[data-slot="scroll-area-viewport"]',
  );
  if (!viewport) throw new Error("Flamegraph viewport was not rendered");
  Object.defineProperty(viewport, "clientHeight", { value: 100 });
  Object.defineProperty(canvas, "releasePointerCapture", { value: vi.fn() });
  viewport.scrollTop = 60;
  fireEvent.pointerUp(canvas, { clientX: 50, clientY: 5 });
  expect(props.onSelect).toHaveBeenCalledWith("clicked");
  const refreshedLayout = { ...props.layout };
  view.rerender(<TraceFlamegraph {...props} layout={refreshedLayout} />);
  view.rerender(
    <TraceFlamegraph
      {...props}
      layout={refreshedLayout}
      selectedSpanId="clicked"
    />,
  );
  expect(viewport.scrollTop).toBe(60);
  view.rerender(<TraceFlamegraph {...props} selectedSpanId="external" />);
  expect(viewport.scrollTop).toBe(430);
  view.rerender(<TraceFlamegraph {...props} selectedSpanId="clicked" />);
  viewport.scrollTop = 60;
  fireEvent.pointerUp(canvas, { clientX: 50, clientY: 5 });
  expect(props.onSelect).toHaveBeenCalledTimes(2);
  expect(viewport.scrollTop).toBe(60);
  view.rerender(<TraceFlamegraph {...props} selectedSpanId="external" />);
  expect(viewport.scrollTop).toBe(430);
  view.rerender(<TraceFlamegraph {...props} selectedSpanId="clicked" />);
  expect(viewport.scrollTop).toBe(0);

  view.rerender(
    <TraceFlamegraph {...props} selectedSpanId={initialSelection} />,
  );
  viewport.scrollTop = 60;
  fireEvent.pointerUp(canvas, { clientX: 50, clientY: 5 });
  view.rerender(
    <TraceFlamegraph {...props} selectedSpanId={competingSelection} />,
  );
  view.rerender(<TraceFlamegraph {...props} selectedSpanId="clicked" />);
  expect(viewport.scrollTop).toBe(0);
});

it("shows a time guide over empty canvas space and updates its time after zoom", () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  const model = buildTraceModel([]);
  const layout = computeVisualLayout([]);
  const props = {
    model,
    layout,
    matchingIds: new Set<string>(),
    filterActive: false,
    colorBy: "service.name",
    range: { start: 0, end: 1000 },
    onRangeChange: vi.fn(),
    onSelect: vi.fn(),
  };
  const view = render(<TraceFlamegraph {...props} />);
  const canvas = view.getByRole("img");
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 1000,
    bottom: 200,
    width: 1000,
    height: 200,
    toJSON: () => ({}),
  });
  fireEvent.pointerMove(canvas, { clientX: 250, clientY: 50 });
  const guide = () =>
    view.container.querySelector<HTMLElement>(
      '[data-slot="flamegraph-crosshair"]',
    );
  expect(guide()?.style.left).toBe("250px");
  expect(guide()).toHaveTextContent("250ms");
  view.rerender(
    <TraceFlamegraph {...props} range={{ start: 500, end: 1500 }} />,
  );
  expect(guide()).toHaveTextContent("750ms");
  fireEvent.pointerLeave(canvas);
  expect(guide()).toBeNull();
});
