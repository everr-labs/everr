import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vite-plus/test";
import { HeatmapVisualization } from "./heatmap-visualization";
import { heatmapSpec } from "./spec";

vi.mock("echarts/core", async (importOriginal) =>
  (await import("@everr/ui/testing/echarts")).ssrEChartsCore(importOriginal),
);

const timeRange = { from: new Date("2026-06-07T00:00:00Z"), to: new Date("2026-06-08T00:00:00Z") };

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: 0, y: 0, width: 400, height: 200 }),
  );
  // jsdom has no pointer capture.
  HTMLElement.prototype.setPointerCapture = vi.fn();
  onTestFinished(() => {
    Reflect.deleteProperty(HTMLElement.prototype, "setPointerCapture");
  });
});

describe("HeatmapVisualization with xColumn", () => {
  function renderRegions() {
    const onTimeRangeChange = vi.fn();
    const view = render(
      <HeatmapVisualization
        timeRange={timeRange}
        onTimeRangeChange={onTimeRangeChange}
        spec={heatmapSpec.parse({ xColumn: "region" })}
        data={[
          [
            { region: "us", tier: "free", requests: 40 },
            { region: "eu", tier: "free", requests: 30 },
            { region: "ap", tier: "free", requests: 15 },
          ],
        ]}
      />,
    );
    const area = screen.getByText(/^Heatmap/).parentElement!;
    return { ...view, area, onTimeRangeChange };
  }

  it("labels the columns with the x values instead of times", () => {
    renderRegions();
    expect(["us", "eu", "ap"].map((region) => screen.getByText(region))).toHaveLength(3);
  });

  it("titles the tooltip with the hovered column's x value", () => {
    const { area } = renderRegions();
    // The rightmost column of the plot is the last region.
    fireEvent.mouseMove(area, { clientX: 390, clientY: 100 });
    expect(screen.getAllByText("ap")).toHaveLength(2);
    expect(screen.getByText("15")).toBeTruthy();
  });

  it("zooms on a drag over time, but not over categories", () => {
    const drag = (area: Element) => {
      fireEvent.pointerDown(area, { button: 0, clientX: 200, clientY: 100 });
      fireEvent.pointerMove(area, { clientX: 390, clientY: 100 });
      fireEvent.pointerUp(area);
    };
    const { area, onTimeRangeChange, rerender } = renderRegions();
    drag(area);
    expect(onTimeRangeChange).not.toHaveBeenCalled();

    rerender(
      <HeatmapVisualization
        timeRange={timeRange}
        onTimeRangeChange={onTimeRangeChange}
        spec={heatmapSpec.parse({})}
        data={[[0, 6, 12, 18].map((h) => ({ ts: Date.UTC(2026, 5, 7, h), tier: "free", n: 1 }))]}
      />,
    );
    drag(screen.getByText(/^Heatmap/).parentElement!);
    expect(onTimeRangeChange).toHaveBeenCalledOnce();
  });
});
