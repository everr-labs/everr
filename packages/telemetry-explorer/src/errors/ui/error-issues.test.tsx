import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubNarrowViewport } from "../../test-utils/viewport";
import type { ErrorsRepositoryLike } from "../data/repository";

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

import { ErrorIssues, type ErrorIssuesSearchValue } from "./error-issues";

function makeRepo(): ErrorsRepositoryLike {
  return {
    searchIssues: vi.fn().mockResolvedValue({ issues: [] }),
    getIssue: vi.fn().mockResolvedValue(null),
    listServices: vi.fn().mockResolvedValue([]),
    attributeKeys: vi.fn().mockResolvedValue([]),
    attributeValues: vi.fn().mockResolvedValue([]),
  } as unknown as ErrorsRepositoryLike;
}

const emptySearch: ErrorIssuesSearchValue = {
  q: "",
  service: [],
  fingerprint: "",
  sort: "lastSeen",
  attributes: [],
};

function ErrorsPageHarness({
  initial = emptySearch,
  environment = [],
  persistentFilters,
  onSearchChange,
}: {
  initial?: ErrorIssuesSearchValue;
  environment?: string[];
  persistentFilters?: ReactNode;
  onSearchChange?: (patch: Partial<ErrorIssuesSearchValue>) => void;
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
      <ErrorIssues
        repo={repo}
        timeRange={{ from: "now-1h", to: "now" }}
        refresh="off"
        search={search}
        environment={environment}
        persistentFilters={persistentFilters}
        onSearchChange={(patch) => {
          onSearchChange?.(patch);
          setSearch((prev) => ({ ...prev, ...patch }));
        }}
        renderIssueLink={({ children }) => <a href="/errors/fp">{children}</a>}
      />
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Errors page filter rail", () => {
  it("puts the persistent zone above the page filters in one rail", () => {
    render(
      <ErrorsPageHarness persistentFilters={<div>persistent zone</div>} />,
    );

    const rail = screen.getByRole("complementary", { name: "Error filters" });
    expect(within(rail).getByText("persistent zone")).toBeInTheDocument();
    expect(within(rail).getByText("Search")).toBeInTheDocument();
    expect(within(rail).getByText("Order")).toBeInTheDocument();
  });

  it("has no search bar outside the rail", () => {
    render(<ErrorsPageHarness />);

    const rail = screen.getByRole("complementary", { name: "Error filters" });
    expect(rail).toContainElement(screen.getByPlaceholderText("Search errors"));
    expect(screen.getAllByPlaceholderText("Search errors")).toHaveLength(1);
  });

  it("applies the search on Enter", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    render(<ErrorsPageHarness onSearchChange={onSearchChange} />);

    const input = screen.getByPlaceholderText("Search errors");
    await user.type(input, "TypeError");
    expect(onSearchChange).not.toHaveBeenCalled();

    await user.type(input, "{Enter}");
    expect(onSearchChange).toHaveBeenCalledWith({ q: "TypeError" });
  });

  it("clears the search but keeps the sort order and Service", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    render(
      <ErrorsPageHarness
        initial={{
          ...emptySearch,
          q: "TypeError",
          sort: "count",
          service: ["demo-api"],
        }}
        onSearchChange={onSearchChange}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Clear page filters" }),
    );

    const patch = onSearchChange.mock.calls[0]?.[0];
    expect(patch).toEqual({ q: "", attributes: [] });
    expect(patch).not.toHaveProperty("sort");
    expect(patch).not.toHaveProperty("service");
  });

  it("below 1024px the rail moves into a sheet behind a Filters button", async () => {
    stubNarrowViewport();
    const user = userEvent.setup();
    render(
      <ErrorsPageHarness persistentFilters={<div>persistent zone</div>} />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Filters/ }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("complementary", { name: "Error filters" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Filters/ }));
    expect(
      screen.getByRole("complementary", { name: "Error filters" }),
    ).toBeInTheDocument();
  });

  it("the narrow Filters button counts the persistent filters it hides", async () => {
    stubNarrowViewport();
    render(
      <ErrorsPageHarness
        initial={{ ...emptySearch, q: "TypeError", service: ["demo-api"] }}
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
