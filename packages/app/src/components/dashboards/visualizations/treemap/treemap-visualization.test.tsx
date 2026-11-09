import { render } from "@testing-library/react";
import * as echarts from "echarts/core";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { treemapSpec } from "./spec";
import { TreemapVisualization } from "./treemap-visualization";

// Exercise the real ECharts layout without requiring a browser canvas.
vi.mock("echarts/core", async (importOriginal) => {
  const core = await importOriginal<typeof echarts>();
  const { SVGRenderer } = await import("echarts/renderers");
  core.use([SVGRenderer]);
  return {
    ...core,
    init: vi.fn(() =>
      core.init(null, undefined, { renderer: "svg", ssr: true, width: 600, height: 300 }),
    ),
  };
});

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
