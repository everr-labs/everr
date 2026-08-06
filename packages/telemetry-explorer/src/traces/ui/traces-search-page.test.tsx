import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubNarrowViewport } from "../../test-utils/viewport";
import type { TracesRepositoryLike } from "../data/repository";

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

import { type TraceSearchValue, TracesSearch } from "./traces-search-page";

const traceRow = {
  traceId: "abc123",
  rootName: "GET /api/orders",
  rootService: "demo-api",
  rootNamespace: "",
  rootStatus: "Ok" as const,
  rootStatusCode: "200",
  startTs: "2026-08-06 12:00:00.000",
  durationNs: "1000000",
  spanCount: 3,
  errorCount: 0,
  services: ["demo-api"],
};

function makeRepo(): TracesRepositoryLike {
  return {
    search: vi.fn().mockResolvedValue([traceRow]),
    getTrace: vi.fn().mockResolvedValue([]),
    listServiceIdentities: vi
      .fn()
      .mockResolvedValue([
        { serviceNamespace: "shop", serviceName: "demo-api" },
      ]),
    attributeKeys: vi.fn().mockResolvedValue([]),
    attributeValues: vi.fn().mockResolvedValue([]),
  } as unknown as TracesRepositoryLike;
}

const emptySearch: TraceSearchValue = {
  namespace: [],
  service: [],
  name: "",
  minMs: undefined,
  maxMs: undefined,
  status: "all",
  attributes: [],
};

/**
 * Holds the search value in the same way as the host route. A filter change is
 * then visible as the value that the page returns, and not as a call to a prop.
 */
function TracesPageHarness({
  initial = emptySearch,
  environment = [],
  persistentFilters,
  onSearchChange,
}: {
  initial?: TraceSearchValue;
  environment?: string[];
  persistentFilters?: ReactNode;
  onSearchChange?: (patch: Partial<TraceSearchValue>) => void;
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
      <TracesSearch
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
        renderTraceLink={({ traceId, className, children }) => (
          <a href={`/traces/${traceId}`} className={className}>
            {children}
          </a>
        )}
      />
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Traces page filter rail", () => {
  it("puts the persistent zone above the page filters in one rail", () => {
    render(
      <TracesPageHarness persistentFilters={<div>persistent zone</div>} />,
    );

    const rail = screen.getByRole("complementary", { name: "Trace filters" });
    expect(within(rail).getByText("persistent zone")).toBeInTheDocument();
    expect(within(rail).getByText("Search")).toBeInTheDocument();
    expect(within(rail).getByText("Status")).toBeInTheDocument();
  });

  it("has no search bar outside the rail", () => {
    render(<TracesPageHarness />);

    const rail = screen.getByRole("complementary", { name: "Trace filters" });
    const input = screen.getByPlaceholderText("Filter by span name");
    expect(rail).toContainElement(input);
    // One field only. The rail holds it, and no second field is above the
    // results.
    expect(screen.getAllByPlaceholderText("Filter by span name")).toHaveLength(
      1,
    );
  });

  it("applies the search on Enter, not on every keystroke", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    render(<TracesPageHarness onSearchChange={onSearchChange} />);

    const input = screen.getByPlaceholderText("Filter by span name");
    await user.type(input, "checkout");
    expect(onSearchChange).not.toHaveBeenCalled();

    await user.type(input, "{Enter}");
    expect(onSearchChange).toHaveBeenCalledWith({ name: "checkout" });
  });

  it("clears the page zone including the search, and leaves Service alone", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    render(
      <TracesPageHarness
        initial={{ ...emptySearch, name: "checkout", service: ["demo-api"] }}
        onSearchChange={onSearchChange}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Clear page filters" }),
    );

    const patch = onSearchChange.mock.calls[0]?.[0];
    expect(patch).toMatchObject({ name: "", status: "all", namespace: [] });
    expect(patch).not.toHaveProperty("service");
    expect(
      (screen.getByPlaceholderText("Filter by span name") as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("below 1024px the rail moves into a sheet behind a Filters button", async () => {
    stubNarrowViewport();
    const user = userEvent.setup();
    render(
      <TracesPageHarness persistentFilters={<div>persistent zone</div>} />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Filters/ }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("complementary", { name: "Trace filters" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Filters/ }));
    expect(
      screen.getByRole("complementary", { name: "Trace filters" }),
    ).toBeInTheDocument();
    expect(screen.getByText("persistent zone")).toBeInTheDocument();
  });

  it("the narrow Filters button counts the persistent filters it hides", async () => {
    stubNarrowViewport();
    render(
      <TracesPageHarness
        initial={{ ...emptySearch, service: ["demo-api"], status: "error" }}
        environment={["production"]}
      />,
    );

    // Service, Environment and Status. The button replaces a rail that the user
    // cannot see, so it must report every filter that narrows the results.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Filters/ })).toHaveTextContent(
        "3",
      ),
    );
  });

  it("badges the HTTP method on the root span name", async () => {
    render(<TracesPageHarness />);

    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "GET /api/orders" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("GET")).toBeInTheDocument();
  });
});
