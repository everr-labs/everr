import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilterSidebar } from "./filter-sidebar";

describe("FilterSidebar", () => {
  it("renders the Filters header and children", () => {
    render(
      <FilterSidebar
        label="Log filters"
        hasActiveFilters={false}
        onClear={vi.fn()}
      >
        <div>child content</div>
      </FilterSidebar>,
    );
    expect(
      screen.getByRole("complementary", { name: "Log filters" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Filters")).toBeInTheDocument();
    expect(screen.getByText("child content")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear page filters" }),
    ).not.toBeInTheDocument();
  });

  it("shows the clear control only when page filters are active and calls onClear", () => {
    const onClear = vi.fn();
    const { rerender } = render(
      <FilterSidebar
        label="Log filters"
        hasActiveFilters={false}
        onClear={onClear}
      >
        <div />
      </FilterSidebar>,
    );
    expect(
      screen.queryByRole("button", { name: "Clear page filters" }),
    ).not.toBeInTheDocument();

    rerender(
      <FilterSidebar label="Log filters" hasActiveFilters onClear={onClear}>
        <div />
      </FilterSidebar>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear page filters" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("puts the persistent zone above the page zone, separated by a divider", () => {
    render(
      <FilterSidebar
        label="Trace filters"
        hasActiveFilters={false}
        onClear={vi.fn()}
        persistentFilters={<div>persistent zone</div>}
      >
        <div>page zone</div>
      </FilterSidebar>,
    );
    const persistent = screen.getByText("persistent zone");
    const page = screen.getByText("page zone");
    expect(persistent.compareDocumentPosition(page)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByRole("presentation")).toBeInTheDocument();
  });

  it("omits the divider when there is no persistent zone", () => {
    render(
      <FilterSidebar
        label="Trace filters"
        hasActiveFilters={false}
        onClear={vi.fn()}
      >
        <div>page zone</div>
      </FilterSidebar>,
    );
    expect(screen.queryByRole("presentation")).not.toBeInTheDocument();
  });
});
