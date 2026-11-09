import { render } from "@testing-library/react";
import * as echarts from "echarts/core";
import { expect, it, vi } from "vite-plus/test";
import { StatSparkline } from "./stat-sparkline";

vi.mock("echarts/core", async (importOriginal) =>
  (await import("@everr/ui/testing/echarts")).ssrEChartsCore(importOriginal, 100),
);

it("spaces samples by their time, not their order", () => {
  render(
    <StatSparkline
      points={[
        { ts: 0, value: 2 },
        { ts: 10, value: 5 },
        { ts: 100, value: 3 },
      ]}
      color="red"
    />,
  );
  const chart = vi.mocked(echarts.init).mock.results.at(-1)!.value;
  const [x0, x10, x100] = [0, 10, 100].map(
    (ts) => chart.convertToPixel({ xAxisIndex: 0 }, ts) as number,
  );
  expect((x10! - x0!) / (x100! - x0!)).toBeCloseTo(0.1);
});
