import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
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
        // oxlint-disable-next-line react/no-array-index-key -- The virtualizer fixture renders items in source order.
        <div key={i}>{itemContent(i, item)}</div>
      ))}
      {/* Lets tests simulate scrolling to the bottom of the virtual list. */}
      <button type="button" data-testid="virtuoso-end-reached" onClick={() => endReached?.()}>
        end
      </button>
      {components?.Footer ? <components.Footer /> : null}
    </div>
  ),
}));

import { TraceResultsList } from "./trace-results-list";

function row(overrides: Partial<TraceSummary> & { traceId: string }): TraceSummary {
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
    <a href={`/traces/${traceId}`} className={className} data-testid="trace-row-link">
      {children}
    </a>
  );
}

type ListProps = Partial<ComponentProps<typeof TraceResultsList>>;

function list(props: ListProps = {}) {
  return (
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
      onClearFilters={() => {}}
      {...props}
    />
  );
}

function renderList(props: ListProps = {}) {
  return render(list(props));
}

describe("TraceResultsList", () => {
  it("links one row per trace and badges only HTTP methods", () => {
    renderList({
      rows: [
        row({ traceId: "abc123", rootName: "POST /api/users" }),
        row({ traceId: "b", rootName: "worker.process_payment" }),
        row({ traceId: "c", rootName: "SELECT users" }),
      ],
    });

    const links = screen.getAllByTestId("trace-row-link");
    expect(links).toHaveLength(3);
    expect(screen.getByRole("link", { name: "POST /api/users" })).toHaveAttribute(
      "href",
      "/traces/abc123",
    );
    // The badge shows the method and the label shows the route. Together they
    // give the original span name, and never "POST POST /api/users".
    expect(screen.getAllByText("POST")).toHaveLength(1);
    expect(screen.getByText("/api/users")).toBeInTheDocument();
    // "SELECT" is a database word and not a method. A badge on it shows a
    // request that did not occur. The query looks in the name link only, so
    // the status badge does not count.
    expect(screen.getByText("worker.process_payment")).toBeInTheDocument();
    expect(screen.getByText("SELECT users")).toBeInTheDocument();
    expect(links[1]?.querySelector("[data-slot=badge]")).toBeNull();
    expect(links[2]?.querySelector("[data-slot=badge]")).toBeNull();
  });

  it("shows the HTTP status code, coloured from whether any span errored", () => {
    // A 404 that the service handles is not a failure. The trace has no span
    // with an error, so the badge stays green although the code is 4xx. The
    // column then agrees with the Status filter, which also reads the spans.
    renderList({
      rows: [
        row({ traceId: "handled", rootStatusCode: "404", errorCount: 0 }),
        row({ traceId: "failed", rootStatusCode: "200", errorCount: 2 }),
        row({ traceId: "plain", rootStatusCode: "", errorCount: 0 }),
      ],
    });

    expect(screen.getByText("404").className).toContain("emerald");
    expect(screen.getByText("200").className).toContain("red");
    // Colour is not the only signal for that state.
    expect(screen.getByLabelText("404, No errors")).toBeInTheDocument();
    expect(screen.getByLabelText("200, 2 errors")).toBeInTheDocument();
    // A root span that is not an HTTP span has no code, so it shows the state.
    expect(screen.getByText("OK")).toBeInTheDocument();
  });

  it("keeps long service names and duration bars inside their columns", () => {
    const longService = "checkout-orchestration-worker-eu-west-1";
    const { container } = renderList({
      rows: [
        row({ traceId: "fast", durationNs: "500000", rootService: longService }),
        row({ traceId: "slow", durationNs: "1000000" }),
      ],
    });

    const name = screen.getByText(longService);
    // The name ends with an ellipsis. It does not wrap and it does not go past
    // the column, so the services stay in one line down the list. An ellipsis
    // hides part of the value, so the full value must stay available.
    expect(name.className).toContain("truncate");
    expect(name).toHaveAttribute("title", longService);

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

  it("shows the empty state with a clear filters action", async () => {
    const user = userEvent.setup();
    const onClearFilters = vi.fn();
    renderList({ onClearFilters });
    await user.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("fetches the next page at the end of the list only when one exists and none is loading", async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    const rows = [row({ traceId: "a", rootName: "GET /a" })];
    const { rerender } = renderList({ rows, hasMore: true, isLoadingMore: true, onLoadMore });

    expect(screen.getByRole("link", { name: "GET /a" })).toBeInTheDocument();
    expect(screen.getByText(/loading more traces/i)).toBeInTheDocument();
    await user.click(screen.getByTestId("virtuoso-end-reached"));
    expect(onLoadMore).not.toHaveBeenCalled();

    rerender(list({ rows, onLoadMore }));
    expect(screen.getByText(/showing all 1 matching traces/i)).toBeInTheDocument();
    await user.click(screen.getByTestId("virtuoso-end-reached"));
    expect(onLoadMore).not.toHaveBeenCalled();

    rerender(list({ rows, onLoadMore, hasMore: true }));
    await user.click(screen.getByTestId("virtuoso-end-reached"));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});
