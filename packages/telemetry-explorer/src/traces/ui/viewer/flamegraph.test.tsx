import { fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TraceFlamegraph } from "./flamegraph";
import { buildTraceModel } from "./model";
import { computeVisualLayout } from "./rendering/compute-visual-layout";

const mocks = vi.hoisted(() => ({ draw: vi.fn() }));
vi.mock("./rendering/use-flamegraph-draw", () => ({
  useFlamegraphDraw: () => mocks.draw,
}));
afterEach(() => vi.unstubAllGlobals());

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
