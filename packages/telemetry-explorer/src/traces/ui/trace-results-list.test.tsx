import type { UseQueryResult } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { TraceSummary } from "../data/types";

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

import { TraceResultsList } from "./trace-results-list";

function row(
  overrides: Partial<TraceSummary> & { traceId: string },
): TraceSummary {
  return {
    rootName: `root-${overrides.traceId}`,
    rootService: "web",
    rootNamespace: "",
    rootStatus: "Ok",
    startTs: "2026-05-20 12:00:00.000",
    durationNs: "1000000",
    spanCount: 1,
    errorCount: 0,
    services: ["web"],
    ...overrides,
  };
}

function queryResult(data: TraceSummary[]): UseQueryResult<TraceSummary[]> {
  return {
    data,
    isPending: false,
    isFetching: false,
    isPlaceholderData: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as UseQueryResult<TraceSummary[]>;
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
    <a
      href={`/traces/${traceId}`}
      className={className}
      data-testid="trace-row-link"
    >
      {children}
    </a>
  );
}

describe("TraceResultsList", () => {
  it("renders one row per trace", () => {
    const rows = [
      row({ traceId: "a", rootName: "GET /a" }),
      row({ traceId: "b", rootName: "GET /b" }),
      row({ traceId: "c", rootName: "GET /c" }),
    ];
    render(
      <TraceResultsList
        query={queryResult(rows)}
        limit={50}
        renderTraceLink={renderTraceLink}
        onLoadMore={() => {}}
        onClearFilters={() => {}}
      />,
    );

    expect(screen.getByText("GET /a")).toBeInTheDocument();
    expect(screen.getByText("GET /b")).toBeInTheDocument();
    expect(screen.getByText("GET /c")).toBeInTheDocument();
    expect(screen.getAllByTestId("trace-row-link")).toHaveLength(3);
  });

  it("sizes duration bars against the max duration in the result set", () => {
    const rows = [
      row({ traceId: "fast", durationNs: "500000" }),
      row({ traceId: "slow", durationNs: "1000000" }),
    ];
    const { container } = render(
      <TraceResultsList
        query={queryResult(rows)}
        limit={50}
        renderTraceLink={renderTraceLink}
        onLoadMore={() => {}}
        onClearFilters={() => {}}
      />,
    );

    const bars = container.querySelectorAll(".bg-primary");
    expect(bars).toHaveLength(2);
    expect((bars[0] as HTMLElement).style.width).toBe("50%");
    expect((bars[1] as HTMLElement).style.width).toBe("100%");
  });

  it("links each row to the trace detail route", async () => {
    const user = userEvent.setup();
    const rows = [row({ traceId: "abc123", rootName: "GET /home" })];
    render(
      <TraceResultsList
        query={queryResult(rows)}
        limit={50}
        renderTraceLink={renderTraceLink}
        onLoadMore={() => {}}
        onClearFilters={() => {}}
      />,
    );

    const link = screen.getByTestId("trace-row-link");
    expect(link).toHaveAttribute("href", "/traces/abc123");
    await user.click(link);
  });

  it("shows the empty state with a clear filters action", async () => {
    const user = userEvent.setup();
    const onClearFilters = vi.fn();
    render(
      <TraceResultsList
        query={queryResult([])}
        limit={50}
        renderTraceLink={renderTraceLink}
        onLoadMore={() => {}}
        onClearFilters={onClearFilters}
      />,
    );
    await user.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("keeps rows visible and shows load-more fetching only on the button", async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    const rows = [row({ traceId: "a", rootName: "GET /a" })];
    const query = {
      ...queryResult(rows),
      isFetching: true,
      isPlaceholderData: true,
    } as unknown as UseQueryResult<TraceSummary[]>;

    render(
      <TraceResultsList
        query={query}
        limit={50}
        renderTraceLink={renderTraceLink}
        onLoadMore={onLoadMore}
        onClearFilters={() => {}}
      />,
    );

    expect(screen.getByText("GET /a")).toBeInTheDocument();
    expect(screen.queryByText("Failed to load traces")).not.toBeInTheDocument();
    expect(screen.queryByText("No traces")).not.toBeInTheDocument();

    const button = screen.getByRole("button", { name: /loading more/i });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onLoadMore).not.toHaveBeenCalled();
  });
});
