import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const useMatchMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => options,
  Outlet: () => <div data-testid="trace-detail-outlet" />,
  useMatch: (options: unknown) => useMatchMock(options),
}));

vi.mock("@/components/traces/traces-search-page", () => ({
  TracesSearchPage: () => <div data-testid="trace-search-page" />,
}));

import { TracesRoute } from "./traces";

describe("traces route", () => {
  it("renders the search page on the traces index route", () => {
    useMatchMock.mockReturnValue(false);

    render(<TracesRoute />);

    expect(screen.getByTestId("trace-search-page")).toBeInTheDocument();
    expect(screen.queryByTestId("trace-detail-outlet")).not.toBeInTheDocument();
  });

  it("renders the detail child route when a trace id is active", () => {
    useMatchMock.mockReturnValue({ params: { traceId: "abc123" } });

    render(<TracesRoute />);

    expect(screen.getByTestId("trace-detail-outlet")).toBeInTheDocument();
    expect(screen.queryByTestId("trace-search-page")).not.toBeInTheDocument();
    expect(useMatchMock).toHaveBeenCalledWith({
      from: "/_authenticated/_dashboard/traces/$traceId",
      shouldThrow: false,
    });
  });
});
