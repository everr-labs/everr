import { render } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { GeoMapVisualization } from "./geo-map-visualization";
import { geoMapSpec } from "./spec";

vi.mock("./world-geometry", () => ({ getWorldCountries: () => [] }));

it("removes stale markers when colocated rows disappear during refresh", () => {
  const spec = geoMapSpec.parse({ min: 0, max: 40, showLegend: false });
  const commonProps = {
    spec,
    timeRange: { from: new Date("2026-10-22T00:00:00Z"), to: new Date("2026-10-23T00:00:00Z") },
    onTimeRangeChange: vi.fn(),
  };
  const { container, rerender } = render(
    <GeoMapVisualization
      {...commonProps}
      data={[
        [
          { lat: 10, lon: 20, value: 30 },
          { lat: 10, lon: 20, value: 20 },
          { lat: 30, lon: 40, value: 10 },
        ],
      ]}
    />,
  );
  rerender(
    <GeoMapVisualization
      {...commonProps}
      data={[
        [
          { lat: 30, lon: 40, value: 40 },
          { lat: 10, lon: 20, value: 20 },
        ],
      ]}
    />,
  );
  expect(
    Array.from(container.querySelectorAll("circle"), (circle) => circle.getAttribute("r")),
  ).toEqual(["22", "12.5"]);
});
