import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
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
        // oxlint-disable-next-line react/no-array-index-key -- The test virtualizer renders a fixed fixture in source order.
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
    totals: vi.fn().mockResolvedValue({ totalCount: 0, levelCounts: ALL_LEVEL_COUNTS }),
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
  it("retains optimistic toggles until external navigation replaces the filters", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    const onSearchChange = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const page = (search: LogsExplorerSearch) => (
      <QueryClientProvider client={queryClient}>
        <LogsExplorer
          repo={repo}
          timeRange={{ from: "now-1h", to: "now" }}
          search={search}
          onSearchChange={onSearchChange}
        />
      </QueryClientProvider>
    );
    const { rerender, unmount } = render(page(emptySearch));
    await user.click(screen.getByRole("button", { name: /^error/i }));
    await user.click(screen.getByRole("button", { name: /^error/i }));
    expect(onSearchChange).toHaveBeenLastCalledWith(expect.objectContaining({ levels: [] }));

    rerender(
      page({
        ...emptySearch,
        q: "external",
        levels: ["info"],
      }),
    );
    expect(screen.getByPlaceholderText("Search messages, errors, IDs")).toHaveValue("external");
    await waitFor(() =>
      expect(repo.explorer).toHaveBeenLastCalledWith(
        expect.objectContaining({
          query: "external",
          levels: ["info"],
        }),
      ),
    );
    unmount();
    queryClient.clear();
  });

  it("puts the persistent zone and the only search field in one rail, and applies the search on Enter", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    render(
      <LogsPageHarness
        persistentFilters={<div>persistent zone</div>}
        onSearchChange={onSearchChange}
      />,
    );

    const rail = screen.getByRole("complementary", { name: "Log filters" });
    expect(within(rail).getByText("persistent zone")).toBeInTheDocument();
    expect(within(rail).getByText("Search")).toBeInTheDocument();
    expect(within(rail).getByText("Severity")).toBeInTheDocument();
    // One field only. The rail holds it, and no second field is above the
    // results.
    const input = screen.getByPlaceholderText("Search messages, errors, IDs");
    expect(rail).toContainElement(input);
    expect(screen.getAllByPlaceholderText("Search messages, errors, IDs")).toHaveLength(1);

    await user.type(input, "timeout");
    expect(onSearchChange).not.toHaveBeenCalled();
    await user.type(input, "{Enter}");
    expect(onSearchChange).toHaveBeenCalledWith(expect.objectContaining({ q: "timeout" }));
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

    await user.click(screen.getByRole("button", { name: "Clear page filters" }));

    const next = onSearchChange.mock.calls[0]?.[0];
    expect(next).toMatchObject({ q: undefined, levels: [], attributes: [] });
    // Service is in the top zone, so a clear of the page zone keeps it.
    expect(next.services).toEqual(["demo-api"]);
  });

  it("below 1024px moves the rail into a sheet behind a Filters button that counts the persistent filters", async () => {
    stubNarrowViewport();
    const user = userEvent.setup();
    render(
      <LogsPageHarness
        initial={{ ...emptySearch, services: ["demo-api"], levels: ["error"] }}
        environment={["production"]}
        persistentFilters={<div>persistent zone</div>}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Filters/ })).toHaveTextContent("3"),
    );
    expect(screen.queryByRole("complementary", { name: "Log filters" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Filters/ }));
    expect(screen.getByRole("complementary", { name: "Log filters" })).toBeInTheDocument();
    expect(screen.getByText("persistent zone")).toBeInTheDocument();
  });
});

describe("Logs page inspector", () => {
  const log = {
    id: "log-1",
    identity: {
      timestampRaw: "2026-11-14 23:04:58.653",
      traceId: "",
      spanId: "",
      serviceName: "checkout-api",
      bodyHash: "1",
    },
    timestamp: "2026-11-14T23:04:58.653Z",
    level: "error",
    body: "failed to reconcile inventory",
  };

  function renderWithLog(logAttributes: Record<string, string> = {}) {
    const repo = makeRepo();
    vi.mocked(repo.explorer).mockResolvedValue({ logs: [log] } as never);
    vi.mocked(repo.detail).mockResolvedValue({
      timestamp: log.timestamp,
      level: "error",
      severityText: "ERROR",
      severityNumber: 17,
      serviceName: log.identity.serviceName,
      traceId: "",
      spanId: "",
      resourceAttributes: {},
      logAttributes,
      scopeAttributes: {},
    } as never);
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <LogsExplorer
          repo={repo}
          timeRange={{ from: "now-1h", to: "now" }}
          search={emptySearch}
          onSearchChange={() => {}}
          renderErrorLink={({ fingerprint }) => <a href={`/errors/${fingerprint}`}>Open Error</a>}
        />
      </QueryClientProvider>,
    );
  }

  it("on a phone opens a log's details in a drawer, without the expand button", async () => {
    stubNarrowViewport();
    const user = userEvent.setup();
    renderWithLog();

    await user.click(await screen.findByRole("button", { name: /failed to reconcile inventory/ }));

    const sheet = await screen.findByRole("dialog", { name: "Log event" });
    expect(within(sheet).getByRole("button", { name: "Close log details" })).toBeInTheDocument();
    expect(
      within(sheet).queryByRole("button", { name: "Expand log details" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: /log/i })).not.toBeInTheDocument();

    await user.click(within(sheet).getByRole("button", { name: "Close log details" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Log event" })).not.toBeInTheDocument(),
    );
  });

  it("from 1024px shows a log's details in the column beside the list", async () => {
    const user = userEvent.setup();
    renderWithLog();

    await user.click(await screen.findByRole("button", { name: /failed to reconcile inventory/ }));

    expect(await screen.findByRole("button", { name: "Expand log details" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Log event" })).not.toBeInTheDocument();
  });

  it("links a log that belongs to an Error to that Error", async () => {
    const user = userEvent.setup();
    renderWithLog({ "everr.error.fingerprint": "7384709629825244683" });

    await user.click(await screen.findByRole("button", { name: /failed to reconcile inventory/ }));

    expect(await screen.findByRole("link", { name: "Open Error" })).toHaveAttribute(
      "href",
      "/errors/7384709629825244683",
    );
  });

  it("shows no Error link for a log outside any Error", async () => {
    const user = userEvent.setup();
    renderWithLog();

    await user.click(await screen.findByRole("button", { name: /failed to reconcile inventory/ }));

    expect(await screen.findByText("Span ID")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open Error" })).not.toBeInTheDocument();
  });
});
