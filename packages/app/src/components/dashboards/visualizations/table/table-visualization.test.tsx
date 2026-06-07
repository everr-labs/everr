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

  it("shows the borderless empty state for a single query with no rows", () => {
    const { container } = render(
      <TableVisualization plugin={plugin} data={[[]]} />,
    );
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
    // No bordered container (the empty state has no border-t).
    expect(container.querySelector(".border-t")).toBeNull();
  });

  it("keeps the selector and shows 'No rows' when a query frame is empty", () => {
    render(<TableVisualization plugin={plugin} data={[[{ a: 1 }], []]} />);
    expect(screen.getByText("Query A")).toBeInTheDocument();
    expect(screen.getByText("Query B")).toBeInTheDocument();
  });
});
