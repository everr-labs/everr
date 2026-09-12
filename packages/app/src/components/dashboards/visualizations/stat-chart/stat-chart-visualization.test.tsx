import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { statChartSpec } from "./spec";
import { StatChartVisualization } from "./stat-chart-visualization";

describe("StatChartVisualization", () => {
  it("displays percent while absolute thresholds compare the original ratio", () => {
    render(
      <StatChartVisualization
        spec={statChartSpec.parse({
          valueFormat: { unit: "1", display: "percent" },
          thresholds: {
            defaultColor: "green",
            steps: [{ value: 0.8, color: "red" }],
          },
        })}
        data={[[{ utilization: 0.75 }]]}
        timeRange={{ from: new Date(0), to: new Date(60000) }}
        onTimeRangeChange={() => {}}
      />,
    );
    expect(screen.getByText("75")).toHaveStyle({ color: "rgb(0, 128, 0)" });
    expect(screen.getByText("%")).toBeInTheDocument();
  });
  it("formats seconds while thresholds still compare the raw value", () => {
    render(
      <StatChartVisualization
        spec={statChartSpec.parse({
          valueFormat: { unit: "s", scale: "duration" },
          thresholds: {
            defaultColor: "green",
            steps: [{ value: 1, color: "red" }],
          },
        })}
        data={[[{ latency: 0.025 }]]}
        timeRange={{ from: new Date(0), to: new Date(60000) }}
        onTimeRangeChange={() => {}}
      />,
    );
    expect(screen.getByText("25")).toHaveStyle({ color: "rgb(0, 128, 0)" });
    expect(screen.getByText("ms")).toBeInTheDocument();
  });
  it("renders semantic byte units without decimal magnitude abbreviations", () => {
    render(
      <StatChartVisualization
        spec={statChartSpec.parse({
          valueFormat: { unit: "By", scale: "binary" },
        })}
        data={[[{ volume: 5 * 1024 ** 3 }]]}
        timeRange={{ from: new Date(0), to: new Date(60_000) }}
        onTimeRangeChange={() => {}}
      />,
    );

    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("GiB")).toBeInTheDocument();
    expect(screen.queryByText("5B")).toBeNull();
  });
});
