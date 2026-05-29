import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { TraceSummary } from "../data/types";

let lastEndReached: (() => void) | undefined;

vi.mock("react-virtuoso", () => ({
  Virtuoso: <T,>({
    data,
    itemContent,
    endReached,
    components,
  }: {
    data: T[];
    itemContent: (index: number, item: T) => React.ReactNode;
    endReached?: () => void;
    components?: { Footer?: () => React.ReactNode };
  }) => {
    lastEndReached = endReached;
    const Footer = components?.Footer;
    return (
      <div data-testid="virtuoso-mock">
        {data.map((item, i) => (
          <div key={i}>{itemContent(i, item)}</div>
        ))}
        {Footer ? <Footer /> : null}
      </div>
    );
  },
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

function defaultProps() {
  return {
    traces: [] as TraceSummary[],
    isPending: false,
    isError: false,
    error: null as Error | null,
    onRetry: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    onLoadMore: vi.fn(),
    renderTraceLink,
    onClearFilters: vi.fn(),
  };
}

describe("TraceResultsList", () => {
  it("renders one row per trace", () => {
    const traces = [
      row({ traceId: "a", rootName: "GET /a" }),
      row({ traceId: "b", rootName: "GET /b" }),
      row({ traceId: "c", rootName: "GET /c" }),
    ];
    render(<TraceResultsList {...defaultProps()} traces={traces} />);

    expect(screen.getByText("GET /a")).toBeInTheDocument();
    expect(screen.getByText("GET /b")).toBeInTheDocument();
    expect(screen.getByText("GET /c")).toBeInTheDocument();
    expect(screen.getAllByTestId("trace-row-link")).toHaveLength(3);
  });

  it("sizes duration bars against the max duration in the result set", () => {
    const traces = [
      row({ traceId: "fast", durationNs: "500000" }),
      row({ traceId: "slow", durationNs: "1000000" }),
    ];
    const { container } = render(
      <TraceResultsList {...defaultProps()} traces={traces} />,
    );

    const bars = container.querySelectorAll(".bg-primary");
    expect(bars).toHaveLength(2);
    expect((bars[0] as HTMLElement).style.width).toBe("50%");
    expect((bars[1] as HTMLElement).style.width).toBe("100%");
  });

  it("shows the empty state with a clear filters action", async () => {
    const user = userEvent.setup();
    const onClearFilters = vi.fn();
    render(
      <TraceResultsList
        {...defaultProps()}
        traces={[]}
        onClearFilters={onClearFilters}
      />,
    );
    await user.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("loads more when the list bottom is reached", () => {
    const onLoadMore = vi.fn();
    render(
      <TraceResultsList
        {...defaultProps()}
        traces={[row({ traceId: "a" })]}
        hasNextPage
        onLoadMore={onLoadMore}
      />,
    );

    expect(screen.getByText("Showing 1 traces")).toBeInTheDocument();
    lastEndReached?.();
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("does not load more while a page is already fetching", () => {
    const onLoadMore = vi.fn();
    render(
      <TraceResultsList
        {...defaultProps()}
        traces={[row({ traceId: "a" })]}
        hasNextPage
        isFetchingNextPage
        onLoadMore={onLoadMore}
      />,
    );

    expect(screen.getByText("Loading more traces")).toBeInTheDocument();
    lastEndReached?.();
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("shows the all-loaded footer when there is no next page", () => {
    render(
      <TraceResultsList
        {...defaultProps()}
        traces={[row({ traceId: "a" }), row({ traceId: "b" })]}
        hasNextPage={false}
      />,
    );
    expect(
      screen.getByText("Showing all 2 matching traces"),
    ).toBeInTheDocument();
  });
});
