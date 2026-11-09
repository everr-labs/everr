import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { LaneTimelineChart } from "./lane-timeline-chart";
import { createTimeCursorStore, SharedTimeCursorProvider } from "./shared-time-cursor";

describe("shared time cursor", () => {
  it("publishes one panel's timestamp to subscribers and clears only its owner", () => {
    const store = createTimeCursorStore();
    const first = Symbol("first panel");
    const second = Symbol("second panel");
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.set(first, 100);
    expect(store.getSnapshot()?.timestamp).toBe(100);
    expect(listener).toHaveBeenCalledTimes(1);

    store.set(second, 200);
    store.clear(first);
    expect(store.getSnapshot()?.timestamp).toBe(200);
    expect(listener).toHaveBeenCalledTimes(2);

    store.clear(second);
    expect(store.getSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    store.set(first, 300);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe("LaneTimelineChart", () => {
  it("marks the instant hovered in another panel of the same dashboard", () => {
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

    fireEvent.mouseMove(screen.getByText("api"), { clientX: 50 });

    const lines = document.querySelectorAll<HTMLElement>("[data-slot=time-cursor]");
    expect([...lines].map((line) => line.style.left)).toEqual(["25%", "25%"]);
  });
});
