import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { stubNarrowViewport } from "../../test-utils/viewport";
import type { SessionRecordingsHost } from "../../recordings/host";
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
        // oxlint-disable-next-line react/no-array-index-key -- The test virtualizer renders a fixed fixture in source order.
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
  withRecording: false,
};

function ErrorsPageHarness({
  initial = emptySearch,
  environment = [],
  persistentFilters,
  sessionRecordings,
  repo: givenRepo,
  onSearchChange,
}: {
  initial?: ErrorIssuesSearchValue;
  environment?: string[];
  persistentFilters?: ReactNode;
  sessionRecordings?: SessionRecordingsHost;
  repo?: ErrorsRepositoryLike;
  onSearchChange?: (patch: Partial<ErrorIssuesSearchValue>) => void;
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
      <ErrorIssues
        repo={repo}
        timeRange={{ from: "now-1h", to: "now" }}
        search={search}
        environment={environment}
        persistentFilters={persistentFilters}
        sessionRecordings={sessionRecordings}
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
  it("puts the persistent zone and the only search field in one rail, and applies the search on Enter", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    render(
      <ErrorsPageHarness
        persistentFilters={<div>persistent zone</div>}
        onSearchChange={onSearchChange}
      />,
    );

    const rail = screen.getByRole("complementary", { name: "Error filters" });
    expect(within(rail).getByText("persistent zone")).toBeInTheDocument();
    expect(within(rail).getByText("Search")).toBeInTheDocument();
    expect(within(rail).getByText("Order")).toBeInTheDocument();
    // One field only. The rail holds it, and no second field is above the
    // results.
    const input = screen.getByPlaceholderText("Search errors");
    expect(rail).toContainElement(input);
    expect(screen.getAllByPlaceholderText("Search errors")).toHaveLength(1);

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

    await user.click(screen.getByRole("button", { name: "Clear page filters" }));

    const patch = onSearchChange.mock.calls[0]?.[0];
    expect(patch).toEqual({ q: "", attributes: [], withRecording: false });
    expect(patch).not.toHaveProperty("sort");
    expect(patch).not.toHaveProperty("service");
  });

  it("below 1024px moves the rail into a sheet behind a Filters button that counts the persistent filters", async () => {
    stubNarrowViewport();
    const user = userEvent.setup();
    render(
      <ErrorsPageHarness
        initial={{ ...emptySearch, q: "TypeError", service: ["demo-api"] }}
        environment={["production"]}
        persistentFilters={<div>persistent zone</div>}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Filters/ })).toHaveTextContent("3"),
    );
    expect(screen.queryByRole("complementary", { name: "Error filters" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Filters/ }));
    expect(screen.getByRole("complementary", { name: "Error filters" })).toBeInTheDocument();
    expect(screen.getByText("persistent zone")).toBeInTheDocument();
  });
});

describe("Errors page session recording filter", () => {
  const host: SessionRecordingsHost = { renderPlayer: () => null };
  const searchedWith = (repo: ErrorsRepositoryLike) =>
    vi.mocked(repo.searchIssues).mock.calls.map(([input]) => input.withRecording);

  it("without a host, draws no switch and ignores withRecording from the URL", async () => {
    const repo = makeRepo();
    render(<ErrorsPageHarness repo={repo} initial={{ ...emptySearch, withRecording: true }} />);

    await waitFor(() => expect(repo.searchIssues).toHaveBeenCalled());
    expect(searchedWith(repo)).toEqual([false]);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear page filters" })).not.toBeInTheDocument();
  });

  it("with a host, searches only recorded Errors once the switch is on", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    render(<ErrorsPageHarness repo={repo} sessionRecordings={host} />);

    await waitFor(() => expect(repo.searchIssues).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("switch", { name: "With session recording" }));

    await waitFor(() => expect(searchedWith(repo)).toEqual([false, true]));
    expect(screen.getByRole("switch", { name: "With session recording" })).toBeChecked();
  });

  it("counts the switch on the narrow Filters button", async () => {
    stubNarrowViewport();
    render(
      <ErrorsPageHarness
        sessionRecordings={host}
        initial={{ ...emptySearch, withRecording: true }}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Filters/ })).toHaveTextContent("1"),
    );
  });
});
