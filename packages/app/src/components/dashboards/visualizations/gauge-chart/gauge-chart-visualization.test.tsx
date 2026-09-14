import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GaugeChartVisualization } from "./gauge-chart-visualization";
import { gaugeChartSpec } from "./spec";

const props = {
  timeRange: { from: new Date(0), to: new Date(60_000) },
  onTimeRangeChange: () => {},
};

describe("GaugeChartVisualization", () => {
  it.each([
    "horizontal",
    "arc",
  ] as const)("attaches percent units in the %s gauge", (variant) => {
    render(
      <GaugeChartVisualization
        {...props}
        spec={gaugeChartSpec.parse({
          variant,
          valueFormat: { unit: "1", display: "percent" },
        })}
        data={[[{ utilization: 0.75 }]]}
      />,
    );

    const unit = screen.getByText("%");
    expect(unit).not.toHaveClass("ml-1");
    expect(unit).not.toHaveAttribute("dx");
  });

  it.each([
    "horizontal",
    "arc",
  ] as const)("separates ordinary units in the %s gauge", (variant) => {
    render(
      <GaugeChartVisualization
        {...props}
        spec={gaugeChartSpec.parse({
          variant,
          max: 1,
          valueFormat: { unit: "s", scale: "duration" },
        })}
        data={[[{ latency: 0.025 }]]}
      />,
    );

    const unit = screen.getByText("ms");
    if (variant === "horizontal") {
      expect(unit).toHaveClass("ml-1");
    } else {
      expect(unit).toHaveAttribute("dx", "1.5");
    }
  });
});
