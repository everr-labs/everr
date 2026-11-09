import { fireEvent, render } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { LaneTimelineChart, laneItemAt } from "./lane-timeline-chart";
import { SharedTimeCursorProvider } from "./shared-time-cursor";

vi.mock("echarts/core", async (importOriginal) =>
  (await import("@everr/ui/testing/echarts")).ssrEChartsCore(importOriginal),
);

it("marks the instant hovered in one panel in every panel of the dashboard", () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: 0, y: 0, width: 200, height: 20 }),
  );
  const lane = (label: string) => (
    <LaneTimelineChart
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

  fireEvent.mouseMove(track, { clientX: 50 });
  expect(cursors()).toEqual(["25%", "25%"]);

  fireEvent.mouseLeave(track);
  expect(cursors()).toEqual([]);
});

it("finds the item under the pointer, with a little slack for narrow ones", () => {
  const items = [
    { start: 0, end: 10, state: "up", title: "" },
    { start: 20, end: 21, state: "down", title: "" },
  ];
  expect(laneItemAt(items, 5, 0)?.state).toBe("up");
  expect(laneItemAt(items, 15, 0)).toBeNull();
  expect(laneItemAt(items, 22, 1)?.state).toBe("down");
});
