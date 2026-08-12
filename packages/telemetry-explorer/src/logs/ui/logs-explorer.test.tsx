import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubNarrowViewport } from "../../test-utils/viewport";
import type { LogsRepositoryLike } from "../data/repository";

vi.mock("react-virtuoso", () => ({
  Virtuoso: <T,>({
    data,
    itemContent,
  }: {
    data: T[];
    itemContent: (index: number, item: T) => ReactNode;
  }) => (
    <div data-testid="virtuoso-mock">
      {data.map((item, i) => (
        <div key={i}>{itemContent(i, item)}</div>
      ))}
    </div>
  ),
}));

import { LogsExplorer, type LogsExplorerSearch } from "./logs-explorer";

// decodeTotalsRows starts from emptyLevelCounts(), so the real repository always
// returns a count for every level. This stub must do the same.
const ALL_LEVEL_COUNTS = {
  error: 0,
  warning: 0,
  info: 0,
  debug: 0,
  trace: 0,
  unknown: 0,
};

function makeRepo(): LogsRepositoryLike {
  return {
    explorer: vi.fn().mockResolvedValue({ logs: [] }),
    totals: vi
      .fn()
      .mockResolvedValue({ totalCount: 0, levelCounts: ALL_LEVEL_COUNTS }),
    histogram: vi.fn().mockResolvedValue([]),
    detail: vi.fn().mockResolvedValue(null),
    filterOptions: vi.fn().mockResolvedValue({ services: [] }),
    attributeKeys: vi.fn().mockResolvedValue([]),
    attributeValues: vi.fn().mockResolvedValue([]),
  } as unknown as LogsRepositoryLike;
}

const emptySearch: LogsExplorerSearch = {
  q: undefined,
  levels: [],
  services: [],
  attributes: [],
  traceId: undefined,
  showVolume: false,
};

function LogsPageHarness({
  initial = emptySearch,
  environment = [],
  persistentFilters,
  onSearchChange,
}: {
  initial?: LogsExplorerSearch;
  environment?: string[];
  persistentFilters?: ReactNode;
  onSearchChange?: (next: LogsExplorerSearch) => void;
}) {
  const [search, setSearch] = useState(initial);
  // One QueryClient and one repository for all renders. A new QueryClient on
  // each render stops every query that is in progress when a filter changes.
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  const [repo] = useState(makeRepo);
  return (
    <QueryClientProvider client={queryClient}>
      <LogsExplorer
        repo={repo}
        timeRange={{ from: "now-1h", to: "now" }}
        search={search}
        environment={environment}
        persistentFilters={persistentFilters}
        onSearchChange={(next) => {
          onSearchChange?.(next);
          setSearch(next);
        }}
      />
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Logs page filter rail", () => {
  it("puts the persistent zone above the page filters in one rail", () => {
    render(<LogsPageHarness persistentFilters={<div>persistent zone</div>} />);

    const rail = screen.getByRole("complementary", { name: "Log filters" });
    expect(within(rail).getByText("persistent zone")).toBeInTheDocument();
    expect(within(rail).getByText("Search")).toBeInTheDocument();
    expect(within(rail).getByText("Severity")).toBeInTheDocument();
  });

  it("has no search bar outside the rail", () => {
    render(<LogsPageHarness />);

    const rail = screen.getByRole("complementary", { name: "Log filters" });
    expect(rail).toContainElement(
      screen.getByPlaceholderText("Search messages, errors, IDs"),
    );
    expect(
      screen.getAllByPlaceholderText("Search messages, errors, IDs"),
    ).toHaveLength(1);
  });

  it("applies the search on Enter", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    render(<LogsPageHarness onSearchChange={onSearchChange} />);

    const input = screen.getByPlaceholderText("Search messages, errors, IDs");
    await user.type(input, "timeout");
    expect(onSearchChange).not.toHaveBeenCalled();

    await user.type(input, "{Enter}");
    expect(onSearchChange).toHaveBeenCalledWith(
      expect.objectContaining({ q: "timeout" }),
    );
  });

  it("clears the page zone including the search, and leaves Service alone", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    render(
      <LogsPageHarness
        initial={{ ...emptySearch, q: "timeout", services: ["demo-api"] }}
        onSearchChange={onSearchChange}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Clear page filters" }),
    );

    const next = onSearchChange.mock.calls[0]?.[0];
    expect(next).toMatchObject({ q: undefined, levels: [], attributes: [] });
    // Service is in the top zone, so a clear of the page zone keeps it.
    expect(next.services).toEqual(["demo-api"]);
  });

  it("below 1024px the rail moves into a sheet behind a Filters button", async () => {
    stubNarrowViewport();
    const user = userEvent.setup();
    render(<LogsPageHarness persistentFilters={<div>persistent zone</div>} />);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Filters/ }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("complementary", { name: "Log filters" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Filters/ }));
    expect(
      screen.getByRole("complementary", { name: "Log filters" }),
    ).toBeInTheDocument();
  });

  it("the narrow Filters button counts the persistent filters it hides", async () => {
    stubNarrowViewport();
    render(
      <LogsPageHarness
        initial={{ ...emptySearch, services: ["demo-api"], levels: ["error"] }}
        environment={["production"]}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Filters/ })).toHaveTextContent(
        "3",
      ),
    );
  });
});
