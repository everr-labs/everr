import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { TraceSummary } from "../data/types";

vi.mock("react-virtuoso", () => ({
  Virtuoso: <T,>({
    data,
    itemContent,
    components,
    endReached,
  }: {
    data: T[];
    itemContent: (index: number, item: T) => React.ReactNode;
    components?: { Footer?: () => React.ReactNode };
    endReached?: () => void;
  }) => (
    <div data-testid="virtuoso-mock">
      {data.map((item, i) => (
        <div key={i}>{itemContent(i, item)}</div>
      ))}
      {/* Lets tests simulate scrolling to the bottom of the virtual list. */}
      <button
        type="button"
        data-testid="virtuoso-end-reached"
        onClick={() => endReached?.()}
      >
        end
      </button>
      {components?.Footer ? <components.Footer /> : null}
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
    rootStatusCode: "",
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

describe("TraceResultsList", () => {
  it("renders one row per trace", () => {
    const rows = [
      row({ traceId: "a", rootName: "GET /a" }),
      row({ traceId: "b", rootName: "GET /b" }),
      row({ traceId: "c", rootName: "GET /c" }),
    ];
    render(
      <TraceResultsList
        rows={rows}
        isPending={false}
        isError={false}
        error={null}
        refetch={() => {}}
        hasMore={false}
        isLoadingMore={false}
        renderTraceLink={renderTraceLink}
        onLoadMore={() => {}}
        onClearFilters={() => {}}
      />,
    );

    expect(screen.getByRole("link", { name: "GET /a" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "GET /b" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "GET /c" })).toBeInTheDocument();
    expect(screen.getAllByTestId("trace-row-link")).toHaveLength(3);
  });

  it("badges the HTTP method and shows it exactly once", () => {
    const rows = [row({ traceId: "a", rootName: "POST /api/users" })];
    render(
      <TraceResultsList
        rows={rows}
        isPending={false}
        isError={false}
        error={null}
        refetch={() => {}}
        hasMore={false}
        isLoadingMore={false}
        renderTraceLink={renderTraceLink}
        onLoadMore={() => {}}
        onClearFilters={() => {}}
      />,
    );

    // The badge shows the method and the label shows the route. Together they
    // give the original span name, and never "POST POST /api/users".
    expect(screen.getAllByText("POST")).toHaveLength(1);
    expect(screen.getByText("/api/users")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "POST /api/users" }),
    ).toBeInTheDocument();
  });

  it("leaves non-HTTP span names unbadged", () => {
    const rows = [
      row({ traceId: "a", rootName: "worker.process_payment" }),
      row({ traceId: "b", rootName: "SELECT users" }),
    ];
    render(
      <TraceResultsList
        rows={rows}
        isPending={false}
        isError={false}
        error={null}
        refetch={() => {}}
        hasMore={false}
        isLoadingMore={false}
        renderTraceLink={renderTraceLink}
        onLoadMore={() => {}}
        onClearFilters={() => {}}
      />,
    );

    expect(screen.getByText("worker.process_payment")).toBeInTheDocument();
    // "SELECT" is a database word and not a method. A badge on it shows a
    // request that did not occur.
    expect(screen.getByText("SELECT users")).toBeInTheDocument();
    // The query looks in the name link only, so the status badge does not count.
    for (const link of screen.getAllByTestId("trace-row-link")) {
      expect(link.querySelector("[data-slot=badge]")).toBeNull();
    }
  });

  it("shows the HTTP status code when the root span carries one", () => {
    const rows = [
      row({ traceId: "a", rootStatusCode: "404", errorCount: 0 }),
      row({ traceId: "b", rootStatusCode: "", errorCount: 0 }),
    ];
    render(
      <TraceResultsList
        rows={rows}
        isPending={false}
        isError={false}
        error={null}
        refetch={() => {}}
        hasMore={false}
        isLoadingMore={false}
        renderTraceLink={renderTraceLink}
        onLoadMore={() => {}}
        onClearFilters={() => {}}
      />,
    );

    expect(screen.getByText("404")).toBeInTheDocument();
    // A root span that is not an HTTP span has no code, so it shows the state.
    expect(screen.getByText("OK")).toBeInTheDocument();
  });

  it("colours the status from whether any span errored, not from the code", () => {
    // A 404 that the service handles is not a failure. The trace has no span
    // with an error, so the badge stays green although the code is 4xx. The
    // column then agrees with the Status filter, which also reads the spans.
    const rows = [
      row({ traceId: "handled", rootStatusCode: "404", errorCount: 0 }),
      row({ traceId: "failed", rootStatusCode: "200", errorCount: 2 }),
    ];
    render(
      <TraceResultsList
        rows={rows}
        isPending={false}
        isError={false}
        error={null}
        refetch={() => {}}
        hasMore={false}
        isLoadingMore={false}
        renderTraceLink={renderTraceLink}
        onLoadMore={() => {}}
        onClearFilters={() => {}}
      />,
    );

    expect(screen.getByText("404").className).toContain("emerald");
    expect(screen.getByText("200").className).toContain("red");
    // Colour is not the only signal for that state.
    expect(screen.getByLabelText("404, No errors")).toBeInTheDocument();
    expect(screen.getByLabelText("200, 2 errors")).toBeInTheDocument();
  });

  it("keeps a long service name inside its column and reachable on hover", () => {
    const longService = "checkout-orchestration-worker-eu-west-1";
    const rows = [row({ traceId: "a", rootService: longService })];
    render(
      <TraceResultsList
        rows={rows}
        isPending={false}
        isError={false}
        error={null}
        refetch={() => {}}
        hasMore={false}
        isLoadingMore={false}
        renderTraceLink={renderTraceLink}
        onLoadMore={() => {}}
        onClearFilters={() => {}}
      />,
    );

    const name = screen.getByText(longService);
    // The name ends with an ellipsis. It does not wrap and it does not go past
    // the column, so the services stay in one line down the list.
    expect(name.className).toContain("truncate");
    // An ellipsis hides part of the value, so the full value must stay
    // available.
    expect(name).toHaveAttribute("title", longService);
  });

  it("sizes duration bars against the max duration in the result set", () => {
    const rows = [
      row({ traceId: "fast", durationNs: "500000" }),
      row({ traceId: "slow", durationNs: "1000000" }),
    ];
    const { container } = render(
      <TraceResultsList
        rows={rows}
        isPending={false}
        isError={false}
        error={null}
        refetch={() => {}}
        hasMore={false}
        isLoadingMore={false}
        renderTraceLink={renderTraceLink}
        onLoadMore={() => {}}
        onClearFilters={() => {}}
      />,
    );

    const bars = container.querySelectorAll(".bg-primary");
    expect(bars).toHaveLength(2);
    expect((bars[0] as HTMLElement).style.width).toBe("50%");
    expect((bars[1] as HTMLElement).style.width).toBe("100%");

    // The track takes the width of its column and does not set a width itself.
    // A fixed width makes the track cover part of the Service column when the
    // Duration column becomes narrower.
    for (const bar of bars) {
      expect((bar.parentElement as HTMLElement).className).toContain("w-full");
    }
  });

  it("links each row to the trace detail route", async () => {
    const user = userEvent.setup();
    const rows = [row({ traceId: "abc123", rootName: "GET /home" })];
    render(
      <TraceResultsList
        rows={rows}
        isPending={false}
        isError={false}
        error={null}
        refetch={() => {}}
        hasMore={false}
        isLoadingMore={false}
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
        rows={[]}
        isPending={false}
        isError={false}
        error={null}
        refetch={() => {}}
        hasMore={false}
        isLoadingMore={false}
        renderTraceLink={renderTraceLink}
        onLoadMore={() => {}}
        onClearFilters={onClearFilters}
      />,
    );
    await user.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("fetches the next page when the list reaches the end", async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    const rows = [row({ traceId: "a", rootName: "GET /a" })];

    render(
      <TraceResultsList
        rows={rows}
        isPending={false}
        isError={false}
        error={null}
        refetch={() => {}}
        hasMore={true}
        isLoadingMore={false}
        renderTraceLink={renderTraceLink}
        onLoadMore={onLoadMore}
        onClearFilters={() => {}}
      />,
    );

    await user.click(screen.getByTestId("virtuoso-end-reached"));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("does not fetch again while a page is already loading", async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    const rows = [row({ traceId: "a", rootName: "GET /a" })];

    render(
      <TraceResultsList
        rows={rows}
        isPending={false}
        isError={false}
        error={null}
        refetch={() => {}}
        hasMore={true}
        isLoadingMore={true}
        renderTraceLink={renderTraceLink}
        onLoadMore={onLoadMore}
        onClearFilters={() => {}}
      />,
    );

    expect(screen.getByRole("link", { name: "GET /a" })).toBeInTheDocument();
    expect(screen.getByText(/loading more traces/i)).toBeInTheDocument();

    await user.click(screen.getByTestId("virtuoso-end-reached"));
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("does not fetch past the last page", async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    const rows = [row({ traceId: "a", rootName: "GET /a" })];

    render(
      <TraceResultsList
        rows={rows}
        isPending={false}
        isError={false}
        error={null}
        refetch={() => {}}
        hasMore={false}
        isLoadingMore={false}
        renderTraceLink={renderTraceLink}
        onLoadMore={onLoadMore}
        onClearFilters={() => {}}
      />,
    );

    expect(
      screen.getByText(/showing all 1 matching traces/i),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId("virtuoso-end-reached"));
    expect(onLoadMore).not.toHaveBeenCalled();
  });
});
