import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { statChartSpec } from "./spec";
import { StatChartVisualization } from "./stat-chart-visualization";

describe("StatChartVisualization", () => {
  it("renders semantic byte units without decimal magnitude abbreviations", () => {
    render(
      <StatChartVisualization
        spec={statChartSpec.parse({ unit: "By", displayUnit: "auto" })}
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
