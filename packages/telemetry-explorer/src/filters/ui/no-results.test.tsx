import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { NoResults, showingAll } from "./no-results";

const lastWeek = { from: "now-7d", to: "now" };

describe("NoResults", () => {
  it("names the time range when no filter is set", () => {
    render(<NoResults noun="logs" timeRange={lastWeek} filterCount={0} onClearFilters={vi.fn()} />);
    expect(screen.getByText("No logs in this time range")).toBeInTheDocument();
    expect(screen.getByText(/Nothing was recorded for the last 7 days/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("blames the filters, and clears them, when some are set", async () => {
    const onClearFilters = vi.fn();
    render(
      <NoResults
        noun="traces"
        timeRange={lastWeek}
        filterCount={2}
        onClearFilters={onClearFilters}
      />,
    );
    expect(screen.getByText("No traces match these filters")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("offers no button when only filters it cannot clear are set", () => {
    render(<NoResults noun="errors" timeRange={lastWeek} filterCount={1} />);
    expect(screen.getByText("No errors match these filters")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });
});

describe("showingAll", () => {
  it("does not say 'all' about a single match", () => {
    expect(showingAll(1, "trace")).toBe("Showing 1 matching trace");
    expect(showingAll(12, "trace")).toBe("Showing all 12 matching traces");
  });
});
