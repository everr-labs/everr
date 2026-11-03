import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { statChartSpec } from "./spec";
import { StatChartVisualization } from "./stat-chart-visualization";

describe("StatChartVisualization", () => {
  it("chooses a foreground for each threshold-colored tile", () => {
    render(
      <StatChartVisualization
        spec={statChartSpec.parse({
          colorMode: "background",
          thresholds: { defaultColor: "#fff", steps: [{ value: 5, color: "#111" }] },
        })}
        data={[[{ alpha: 2, beta: 10 }]]}
        timeRange={{ from: new Date(0), to: new Date(60000) }}
        onTimeRangeChange={() => {}}
      />,
    );

    expect(screen.getByText("alpha").closest('[style*="background"]')).toHaveStyle({
      color: "#000",
    });
    expect(screen.getByText("beta").closest('[style*="background"]')).toHaveStyle({
      color: "#fff",
    });
  });

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
    expect(screen.getByText("%")).not.toHaveClass("ml-1");
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
    expect(screen.getByText("ms")).toHaveClass("ml-1");
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
