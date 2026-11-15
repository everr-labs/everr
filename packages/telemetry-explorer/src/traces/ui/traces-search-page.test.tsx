import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { stubNarrowViewport } from "../../test-utils/viewport";
import type { SessionRecordingsHost } from "../../recordings/host";
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
        // oxlint-disable-next-line react/no-array-index-key -- The test virtualizer renders a fixed fixture in source order.
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
      .mockResolvedValue([{ serviceNamespace: "shop", serviceName: "demo-api" }]),
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
  withRecording: false,
};

/**
 * Holds the search value in the same way as the host route. A filter change is
 * then visible as the value that the page returns, and not as a call to a prop.
 */
function TracesPageHarness({
  initial = emptySearch,
  environment = [],
  persistentFilters,
  sessionRecordings,
  repo: givenRepo,
  onSearchChange,
}: {
  initial?: TraceSearchValue;
  environment?: string[];
  persistentFilters?: ReactNode;
  sessionRecordings?: SessionRecordingsHost;
  repo?: TracesRepositoryLike;
  onSearchChange?: (patch: Partial<TraceSearchValue>) => void;
}) {
  const [search, setSearch] = useState(initial);
  // One QueryClient and one repository for all renders. A new QueryClient on
  // each render stops every query that is in progress when a filter changes.
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  const [repo] = useState(() => givenRepo ?? makeRepo());
  return (
    <QueryClientProvider client={queryClient}>
      <TracesSearch
        repo={repo}
        timeRange={{ from: "now-1h", to: "now" }}
        refresh="off"
        search={search}
        environment={environment}
        persistentFilters={persistentFilters}
        sessionRecordings={sessionRecordings}
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
  it("puts the persistent zone and the only search field in one rail, and applies the search on Enter", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    render(
      <TracesPageHarness
        persistentFilters={<div>persistent zone</div>}
        onSearchChange={onSearchChange}
      />,
    );

    const rail = screen.getByRole("complementary", { name: "Trace filters" });
    expect(within(rail).getByText("persistent zone")).toBeInTheDocument();
    expect(within(rail).getByText("Search")).toBeInTheDocument();
    expect(within(rail).getByText("Status")).toBeInTheDocument();
    // One field only. The rail holds it, and no second field is above the
    // results.
    const input = screen.getByPlaceholderText("Filter by span name");
    expect(rail).toContainElement(input);
    expect(screen.getAllByPlaceholderText("Filter by span name")).toHaveLength(1);
    expect(await screen.findByRole("link", { name: "GET /api/orders" })).toBeInTheDocument();

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

    await user.click(screen.getByRole("button", { name: "Clear page filters" }));

    const patch = onSearchChange.mock.calls[0]?.[0];
    expect(patch).toMatchObject({ name: "", status: "all", namespace: [] });
    expect(patch).not.toHaveProperty("service");
    expect((screen.getByPlaceholderText("Filter by span name") as HTMLInputElement).value).toBe("");
  });

  it("below 1024px moves the rail into a sheet behind a Filters button that counts the persistent filters", async () => {
    stubNarrowViewport();
    const user = userEvent.setup();
    render(
      <TracesPageHarness
        initial={{ ...emptySearch, service: ["demo-api"], status: "error" }}
        environment={["production"]}
        persistentFilters={<div>persistent zone</div>}
      />,
    );

    // Service, Environment and Status. The button replaces a rail that the user
    // cannot see, so it must report every filter that narrows the results.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Filters/ })).toHaveTextContent("3"),
    );
    expect(screen.queryByRole("complementary", { name: "Trace filters" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Filters/ }));
    expect(screen.getByRole("complementary", { name: "Trace filters" })).toBeInTheDocument();
    expect(screen.getByText("persistent zone")).toBeInTheDocument();
  });
});

describe("Traces page session recording filter", () => {
  const host: SessionRecordingsHost = { renderPlayer: () => null };
  const searchedWith = (repo: TracesRepositoryLike) =>
    vi.mocked(repo.search).mock.calls.map(([input]) => input.withRecording);

  it("without a host, draws no switch and ignores withRecording from the URL", async () => {
    const repo = makeRepo();
    render(<TracesPageHarness repo={repo} initial={{ ...emptySearch, withRecording: true }} />);

    await waitFor(() => expect(repo.search).toHaveBeenCalled());
    expect(searchedWith(repo)).toEqual([false]);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear page filters" })).not.toBeInTheDocument();
  });

  it("with a host, searches only recorded traces once the switch is on", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render(<TracesPageHarness repo={repo} sessionRecordings={host} />);

    await waitFor(() => expect(repo.search).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("switch", { name: "With session recording" }));

    await waitFor(() => expect(searchedWith(repo)).toEqual([false, true]));
    expect(screen.getByRole("switch", { name: "With session recording" })).toBeChecked();
  });

  it("counts the switch on the narrow Filters button", async () => {
    stubNarrowViewport();
    render(
      <TracesPageHarness
        sessionRecordings={host}
        initial={{ ...emptySearch, withRecording: true }}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Filters/ })).toHaveTextContent("1"),
    );
  });
});
