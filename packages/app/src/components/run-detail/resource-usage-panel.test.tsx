import { describe, expect, it } from "vite-plus/test";
import type { JobResourceUsage } from "#app/data/resource-usage.ts";
import { stepSampleRange } from "./resource-usage-panel";

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

describe("stepSampleRange", () => {
  const [first, second] = usage.points;
  const at = (timestamp: number) => ({ ...first!, timestamp });
  const points = [first!, second!, at(3_000), at(4_000)];

  it.each([
    [
      "a step between two samples shades both",
      { startTime: 1_200, endTime: 1_400 },
      { from: 0, to: 1 },
    ],
    [
      "a step on sample times shades exactly those",
      { startTime: 2_000, endTime: 3_000 },
      { from: 1, to: 2 },
    ],
    [
      "a step past the samples is clamped",
      { startTime: 3_500, endTime: 9_000 },
      { from: 2, to: 3 },
    ],
    ["a step outside the samples shades nothing", { startTime: 5_000, endTime: 6_000 }, null],
  ])("%s", (_, window, expected) => {
    expect(stepSampleRange(points, window)).toEqual(expected);
  });
});
