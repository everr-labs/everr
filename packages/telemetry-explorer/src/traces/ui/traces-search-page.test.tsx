import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { TracesRepositoryLike } from "../data/repository";
import type { TraceSummary } from "../data/types";
import { type TraceSearchValue, TracesSearch } from "./traces-search-page";

vi.mock("react-virtuoso", () => ({
  Virtuoso: <T,>({
    data,
    itemContent,
  }: {
    data: T[];
    itemContent: (index: number, item: T) => React.ReactNode;
  }) => (
    <div data-testid="virtuoso-mock">
      {data.map((item, i) => (
        <div key={i}>{itemContent(i, item)}</div>
      ))}
    </div>
  ),
}));

const defaultSearch: TraceSearchValue = {
  namespace: [],
  service: [],
  name: "",
  minMs: undefined,
  maxMs: undefined,
  status: "all",
};

function summary(traceId: string): TraceSummary {
  return {
    traceId,
    rootName: `root ${traceId}`,
    rootService: "web",
    rootNamespace: "frontend",
    rootStatus: "Ok",
    startTs: "0",
    durationNs: "1000",
    spanCount: 1,
    errorCount: 0,
    services: ["web"],
  };
}

function createRepo(
  result: { traces: TraceSummary[] } = { traces: [] },
): TracesRepositoryLike {
  return {
    search: vi.fn(async () => result),
    getTrace: vi.fn(async () => []),
    listServiceIdentities: vi.fn(async () => [
      { serviceNamespace: "frontend", serviceName: "web" },
    ]),
  };
}

function renderTraceLink({
  traceId,
  className,
  children,
}: {
  traceId: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <a href={`/traces/${traceId}`} className={className}>
      {children}
    </a>
  );
}

function renderSearch({
  search = defaultSearch,
  onSearchChange = vi.fn(),
  repo = createRepo(),
}: {
  search?: TraceSearchValue;
  onSearchChange?: (patch: Partial<TraceSearchValue>) => void;
  repo?: TracesRepositoryLike;
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <TracesSearch
        repo={repo}
        timeRange={{ from: "now-1h", to: "now" }}
        refresh=""
        search={search}
        onSearchChange={onSearchChange}
        renderTraceLink={renderTraceLink}
      />
    </QueryClientProvider>,
  );
}

describe("TracesSearch", () => {
  it("places span search above the filter sidebar", async () => {
    renderSearch();

    const searchInput = screen.getByRole("searchbox", {
      name: "Search traces",
    });
    const filters = screen.getByRole("complementary", {
      name: "Trace filters",
    });

    expect(searchInput).toHaveAttribute("placeholder", "Search span names");
    expect(
      searchInput.compareDocumentPosition(filters) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("submits and clears span search from the top search form", async () => {
    const onSearchChange = vi.fn();
    renderSearch({ onSearchChange });

    const searchInput = screen.getByRole("searchbox", {
      name: "Search traces",
    });
    await userEvent.type(searchInput, "checkout");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(onSearchChange).toHaveBeenCalledWith({ name: "checkout" });

    cleanup();
    renderSearch({
      search: { ...defaultSearch, name: "checkout" },
      onSearchChange,
    });
    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(onSearchChange).toHaveBeenCalledWith({ name: "" });
  });

  it("renders fetched traces from the infinite query", async () => {
    const repo = createRepo({ traces: [summary("a"), summary("b")] });
    renderSearch({ repo });

    expect(await screen.findByText("root a")).toBeInTheDocument();
    expect(screen.getByText("root b")).toBeInTheDocument();
  });

  it("passes filter changes through without a page param", async () => {
    const onSearchChange = vi.fn();
    renderSearch({ onSearchChange });

    await userEvent.click(screen.getByRole("button", { name: "Error" }));

    expect(onSearchChange).toHaveBeenCalledWith({ status: "error" });
  });
});
