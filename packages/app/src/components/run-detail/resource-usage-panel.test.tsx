import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { JobResourceUsage } from "@/data/resource-usage";
import { ResourceUsagePanel } from "./resource-usage-panel";

vi.mock("@/components/ui/chart", () => ({
  ChartContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="chart-container">{children}</div>
  ),
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
}));

vi.mock("recharts", async () => {
  const React = await import("react");

  const Area = ({ dataKey }: { dataKey: string }) => (
    <g data-key={dataKey} data-kind="area" />
  );
  const CartesianGrid = () => <g data-kind="grid" />;
  const ReferenceArea = ({ label }: { label?: { value?: string } }) => (
    <g data-kind="reference-area">
      <text>{label?.value}</text>
    </g>
  );

  const supportedTypes = new Set<unknown>([Area, CartesianGrid, ReferenceArea]);

  const AreaChart = ({ children }: { children: React.ReactNode }) => {
    const supportedChildren = React.Children.toArray(children).filter(
      (child) =>
        React.isValidElement(child) ? supportedTypes.has(child.type) : false,
    );

    return (
      <svg data-testid="area-chart">
        <title>Area chart</title>
        {supportedChildren}
      </svg>
    );
  };

  return {
    Area,
    AreaChart,
    CartesianGrid,
    ReferenceArea,
    XAxis: () => null,
    YAxis: () => null,
  };
});

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
  it("labels the highlight with the current step name", () => {
    render(
      <ResourceUsagePanel
        data={usage}
        stepWindow={{ startTime: 1_200, endTime: 1_400 }}
        selectedStepName="Lint"
      />,
    );

    expect(screen.getAllByText("Lint").length).toBeGreaterThan(0);
    expect(screen.queryByText("Current step")).not.toBeInTheDocument();
  });

  it("renders overlays after the chart areas so they stay visible", () => {
    const { getAllByTestId } = render(
      <ResourceUsagePanel
        data={usage}
        stepWindow={{ startTime: 1_200, endTime: 1_400 }}
        selectedStepName="Lint"
      />,
    );

    const firstChart = getAllByTestId("area-chart")[0];
    const layers = Array.from(firstChart.querySelectorAll("[data-kind]")).map(
      (node) => node.getAttribute("data-kind"),
    );

    expect(layers.indexOf("area")).toBeLessThan(
      layers.indexOf("reference-area"),
    );
    expect(layers.includes("reference-line")).toBe(false);
  });
});
