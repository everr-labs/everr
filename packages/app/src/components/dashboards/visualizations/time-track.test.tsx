import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { LaneTimelineChart } from "./lane-timeline-chart";
import { SharedTimeCursorProvider } from "./shared-time-cursor";

it("marks the instant hovered in one panel in every panel of the dashboard", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: 0, y: 0, width: 200, height: 20 }),
  );
  const lane = (label: string) => (
    <LaneTimelineChart
      lanes={[{ label, items: [{ key: 0, start: 0, end: 1000, state: "up", title: "" }] }]}
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
  render(
    <SharedTimeCursorProvider>
      {lane("api")}
      {lane("db")}
    </SharedTimeCursorProvider>,
  );
  const cursors = () =>
    [...document.querySelectorAll<HTMLElement>("[data-slot=time-cursor]")].map(
      (line) => line.style.left,
    );

  fireEvent.mouseMove(screen.getByText("api"), { clientX: 50 });
  expect(cursors()).toEqual(["25%", "25%"]);

  fireEvent.mouseLeave(screen.getByText("api"));
  expect(cursors()).toEqual([]);
});
