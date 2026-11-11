import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { LaneTimelineChart } from "./lane-timeline-chart";
import { SharedTimeCursorProvider } from "./shared-time-cursor";

vi.mock("echarts/core", async (importOriginal) =>
  (await import("@everr/ui/testing/echarts")).ssrEChartsCore(importOriginal),
);

function lane(label: string) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: 0, y: 0, width: 400, height: 200 }),
  );
  return (
    <LaneTimelineChart
      kind="State timeline"
      lanes={[{ label, items: [{ start: 0, end: 1000, state: "up", title: "" }] }]}
      states={["up"]}
      colorByState={{ up: "green" }}
      domain={[0, 1000]}
      rowHeight={0.8}
      showValues={false}
      showLegend={false}
      empty={null}
      onTimeRangeChange={() => {}}
    />
  );
}

it("shows the hovered block and marks its instant in every panel of the dashboard", () => {
  const { container } = render(
    <SharedTimeCursorProvider>
      {lane("api")}
      {lane("db")}
    </SharedTimeCursorProvider>,
  );
  const cursors = () =>
    [...container.querySelectorAll<HTMLElement>("[data-slot=time-cursor]")].map(
      (line) => line.style.left,
    );
  const track = container.querySelector("[data-slot=time-track]")!;

  fireEvent.mouseMove(track, { clientX: 300, clientY: 50 });
  expect(screen.getByText("up")).toBeInTheDocument();
  const [first, second] = cursors();
  expect(cursors()).toHaveLength(2);
  expect(second).toBe(first);

  fireEvent.mouseLeave(track);
  expect(screen.queryByText("up")).toBeNull();
  expect(cursors()).toEqual([]);
});

it("shows nothing over the gap between lanes", () => {
  const { container } = render(lane("api"));
  const track = container.querySelector("[data-slot=time-track]")!;

  // The bar fills the middle 80% of the lane: its top edge is gap.
  fireEvent.mouseMove(track, { clientX: 300, clientY: 2 });
  expect(screen.queryByText("up")).toBeNull();

  fireEvent.mouseMove(track, { clientX: 300, clientY: 100 });
  expect(screen.getByText("up")).toBeInTheDocument();
});
