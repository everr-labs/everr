import { render } from "@testing-library/react";
import * as echarts from "echarts/core";
import { describe, expect, it, vi } from "vite-plus/test";
import { StatSparkline } from "./stat-sparkline";

vi.mock("echarts/core", async (importOriginal) => {
  const core = await importOriginal<typeof echarts>();
  const { SVGRenderer } = await import("echarts/renderers");
  core.use([SVGRenderer]);
  return {
    ...core,
    init: vi.fn(() =>
      core.init(null, undefined, { renderer: "svg", ssr: true, width: 600, height: 100 }),
    ),
  };
});

describe("StatSparkline", () => {
  it("preserves sample spacing, updates the chart, and disposes it on unmount", () => {
    const points = [
      { ts: 0, value: 2 },
      { ts: 10, value: 5 },
      { ts: 100, value: 3 },
    ];
    const { rerender, unmount } = render(<StatSparkline points={points} color="red" />);
    const chart = vi.mocked(echarts.init).mock.results.at(-1)!.value;
    const x0 = chart.convertToPixel({ xAxisIndex: 0 }, 0) as number;
    const x10 = chart.convertToPixel({ xAxisIndex: 0 }, 10) as number;
    const x100 = chart.convertToPixel({ xAxisIndex: 0 }, 100) as number;
    expect((x10 - x0) / (x100 - x0)).toBeCloseTo(0.1);

    rerender(<StatSparkline points={[...points, { ts: 200, value: 7 }]} color="blue" />);
    expect(chart.getOption().series[0]).toMatchObject({
      data: [
        [0, 2],
        [10, 5],
        [100, 3],
        [200, 7],
      ],
      lineStyle: { color: "blue" },
    });
    unmount();
    expect(chart.isDisposed()).toBe(true);
  });
});
