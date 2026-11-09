import { render } from "@testing-library/react";
import * as echarts from "echarts/core";
import { describe, expect, it, vi } from "vite-plus/test";
import type { JobResourceUsage } from "#app/data/resource-usage.ts";
import { ResourceUsagePanel } from "./resource-usage-panel";

vi.mock("echarts/core", async (importOriginal) =>
  (await import("@everr/ui/testing/echarts")).ssrEChartsCore(importOriginal),
);

const usage: JobResourceUsage = {
  points: [
    {
      timestamp: 1_000,
      cpuAvg: 20,
      cpuMax: 40,
      memoryUsed: 512,
      memoryLimit: 1_024,
      memoryUtilization: 50,
      filesystemUsed: 2_048,
      filesystemLimit: 4_096,
      filesystemUtilization: 50,
      networkReceive: 0,
      networkTransmit: 0,
    },
    {
      timestamp: 2_000,
      cpuAvg: 30,
      cpuMax: 45,
      memoryUsed: 640,
      memoryLimit: 1_024,
      memoryUtilization: 62.5,
      filesystemUsed: 2_560,
      filesystemLimit: 4_096,
      filesystemUtilization: 62.5,
      networkReceive: 0,
      networkTransmit: 0,
    },
  ],
  summary: {
    cpuAvg: 25,
    cpuPeak: 45,
    memoryPeak: 640,
    memoryLimit: 1_024,
    filesystemPeak: 2_560,
    filesystemLimit: 4_096,
    networkTotalReceive: 0,
    networkTotalTransmit: 0,
  },
  sampleIntervalSeconds: 5,
};

describe("ResourceUsagePanel", () => {
  const [first, second] = usage.points;
  const at = (timestamp: number) => ({ ...first!, timestamp });
  const data = { ...usage, points: [first!, second!, at(3_000), at(4_000)] };

  /** The samples the CPU chart shades for the step, by index. */
  function shaded(stepWindow: { startTime: number; endTime: number }) {
    vi.mocked(echarts.init).mockClear();
    render(<ResourceUsagePanel data={data} stepWindow={stepWindow} />);
    const chart = vi.mocked(echarts.init).mock.results[0]!.value;
    const area = chart.getOption().series[0].markArea?.data?.[0];
    return area ? [Number(area[0].xAxis), Number(area[1].xAxis)] : null;
  }

  it.each([
    ["a step between two samples shades both", { startTime: 1_200, endTime: 1_400 }, [0, 1]],
    ["a step on sample times shades exactly those", { startTime: 2_000, endTime: 3_000 }, [1, 2]],
    ["a step past the samples is clamped", { startTime: 3_500, endTime: 9_000 }, [2, 3]],
    ["a step outside the samples shades nothing", { startTime: 5_000, endTime: 6_000 }, null],
  ])("%s", (_, stepWindow, expected) => {
    expect(shaded(stepWindow)).toEqual(expected);
  });
});
