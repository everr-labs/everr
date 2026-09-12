import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { QueryResultRow } from "../index";
import { tableSpec } from "./spec";
import { TableVisualization } from "./table-visualization";

const spec = tableSpec.parse({});

function renderTable(data: QueryResultRow[][]) {
  return render(
    <TableVisualization
      spec={spec}
      data={data}
      timeRange={{ from: new Date(0), to: new Date(60_000) }}
      onTimeRangeChange={() => {}}
    />,
  );
}

describe("TableVisualization", () => {
  it("uses the shared two-decimal default for numeric cells", () => {
    renderTable([[{ value: 42.56789 }]]);
    expect(screen.getByText("42.57")).toBeInTheDocument();
  });
  it("shows no selector for a single query", () => {
    renderTable([[{ a: 1 }]]);
    expect(screen.queryByText("Query B")).toBeNull();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("shows a selector with one entry per query", () => {
    renderTable([[{ a: 1 }], [{ a: 2 }]]);
    expect(screen.getByText("Query A")).toBeInTheDocument();
    expect(screen.getByText("Query B")).toBeInTheDocument();
  });

  it("shows the borderless empty state for a single query with no rows", () => {
    const { container } = renderTable([[]]);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
    // No bordered container (the empty state has no border-t).
    expect(container.querySelector(".border-t")).toBeNull();
  });

  it("keeps the selector and shows 'No rows' when a query frame is empty", () => {
    renderTable([[{ a: 1 }], []]);
    expect(screen.getByText("Query A")).toBeInTheDocument();
    expect(screen.getByText("Query B")).toBeInTheDocument();
  });
});

describe("TableVisualization value formats", () => {
  it("applies column overrides and leaves text and null cells intact", () => {
    render(
      <TableVisualization
        spec={tableSpec.parse({
          valueFormat: { unit: "widgets", scale: "decimal" },
          columns: {
            bandwidth: { valueFormat: { unit: "By/s", scale: "binary" } },
            latency: { valueFormat: { unit: "s", scale: "duration" } },
            utilization: { valueFormat: { unit: "1", display: "percent" } },
            frequency: { valueFormat: { unit: "Hz", scale: "decimal" } },
            unformatted: { valueFormat: {} },
          },
        })}
        data={[
          [
            {
              count: 12500,
              bandwidth: 2621440,
              latency: 0.025,
              utilization: 0.75,
              frequency: 3.2e9,
              text: "12500",
              missing: null,
              unformatted: 12000,
            },
          ],
        ]}
        timeRange={{ from: new Date(0), to: new Date(60000) }}
        onTimeRangeChange={() => {}}
      />,
    );
    for (const label of [
      "12.5k widgets",
      "2.5 MiB/s",
      "25 ms",
      "75%",
      "3.2 GHz",
      "12500",
      "NULL",
      "12,000",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
