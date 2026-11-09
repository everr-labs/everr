import { render } from "@testing-library/react";
import * as echarts from "echarts/core";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { treemapSpec } from "./spec";
import { TreemapVisualization } from "./treemap-visualization";

vi.mock("echarts/core", async (importOriginal) =>
  (await import("@everr/ui/testing/echarts")).ssrEChartsCore(importOriginal),
);

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

it("labels each tile with its name and value in a color readable on the tile", () => {
  render(
    <TreemapVisualization
      spec={treemapSpec.parse({ valueFormat: { unit: "{request}", scale: "decimal" } })}
      data={[
        [
          { name: "/api/users", value: 1200 },
          { name: "/api/orders", value: 800 },
        ],
      ]}
      timeRange={{ from: new Date(0), to: new Date(1) }}
      onTimeRangeChange={() => {}}
    />,
  );

  const chart = vi.mocked(echarts.init).mock.results.at(-1)!.value;
  const svg: string = chart.renderToSVGString();
  for (const text of ["/api/users", "1.2k request", "/api/orders", "800 request"]) {
    expect(svg).toContain(text);
  }
  // The second palette color is a light yellow, where white text is unreadable.
  const [, yellow] = chart.getOption().series[0].data;
  expect(yellow.label.color).toBe("#000");
});
