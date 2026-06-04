import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilterSidebar } from "./filter-sidebar";

describe("FilterSidebar", () => {
  it("renders the Filter header and children", () => {
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
    expect(screen.getByText("Filter")).toBeInTheDocument();
    expect(screen.getByText("child content")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear all" }),
    ).not.toBeInTheDocument();
  });

  it("shows Clear all only when filters are active and calls onClear", () => {
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
      screen.queryByRole("button", { name: "Clear all" }),
    ).not.toBeInTheDocument();

    rerender(
      <FilterSidebar label="Log filters" hasActiveFilters onClear={onClear}>
        <div />
      </FilterSidebar>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
