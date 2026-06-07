import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TableVisualization } from "./table-visualization";

const plugin = { kind: "Table", spec: {} };

describe("TableVisualization", () => {
  it("shows no selector for a single query", () => {
    render(<TableVisualization plugin={plugin} data={[[{ a: 1 }]]} />);
    expect(screen.queryByText("Query B")).toBeNull();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("shows a selector with one entry per query", () => {
    render(
      <TableVisualization plugin={plugin} data={[[{ a: 1 }], [{ a: 2 }]]} />,
    );
    expect(screen.getByText("Query A")).toBeInTheDocument();
    expect(screen.getByText("Query B")).toBeInTheDocument();
  });
});
