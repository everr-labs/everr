import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType, ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import type { ErrorIssueSummary, RelatedSpan } from "../data/types";

function withQueryClient(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

vi.mock("react-virtuoso", () => ({
  Virtuoso: <T, C>({
    data,
    itemContent,
    components,
    context,
  }: {
    data: T[];
    itemContent: (index: number, item: T) => React.ReactNode;
    components?: { Footer?: ComponentType<{ context: C }> };
    context: C;
  }) => {
    const Footer = components?.Footer;
    return (
      <div data-testid="virtuoso-mock">
        {data.map((item, i) => (
          // oxlint-disable-next-line react/no-array-index-key -- Virtuoso mock over generic T[] with no stable identity; index mirrors the real component's index arg
          <div key={i}>{itemContent(i, item)}</div>
        ))}
        {Footer ? <Footer context={context} /> : null}
      </div>
    );
  },
}));

import type { ErrorsRepositoryLike } from "../data/repository";
import { ErrorFilters } from "./error-filters";
import { ErrorIssueList } from "./error-issue-list";
import { ErrorTracePanel } from "./error-trace-panel";

const issue: ErrorIssueSummary = {
  fingerprint: "fp-1",
  exceptionType: "TypeError",
  exceptionMessage: "Cannot read properties of undefined",
  body: "TypeError: boom",
  latestServiceName: "web",
  services: ["web"],
  occurrenceCount: 3,
  traceCount: 2,
  firstSeen: "2026-05-26 10:00:00.000000000",
  lastSeen: "2026-05-26 10:05:00.000000000",
  latestTraceId: "trace-1",
  latestSpanId: "span-1",
  latestTimestamp: "2026-05-26 10:05:00.000000000",
  trend: [0, 1, 2],
};

function listProps() {
  return {
    isPending: false,
    isError: false,
    error: null,
    onRetry: vi.fn(),
    onClearFilters: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    onLoadMore: vi.fn(),
    renderIssueLink: ({
      fingerprint,
      className,
      children,
    }: {
      fingerprint: string;
      className: string;
      children: ReactNode;
    }) => (
      <a href={`/errors/${fingerprint}`} className={className}>
        {children}
      </a>
    ),
  };
}

describe("ErrorIssueList", () => {
  it("renders one row for each Error, with the same columns as the Traces list", () => {
    render(<ErrorIssueList {...listProps()} issues={[issue]} />);

    // The link holds the type and the message, and its name keeps them apart.
    expect(
      screen.getByRole("link", { name: "TypeError Cannot read properties of undefined" }),
    ).toHaveAttribute("href", "/errors/fp-1");
    expect(screen.getByText("Occurrences")).toBeInTheDocument();
    expect(screen.getByText("3", { selector: "span.tabular-nums" })).toHaveTextContent(
      "3 occurrences",
    );
    expect(screen.getByLabelText(/busiest interval has 2/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy fingerprint" })).toBeInTheDocument();
  });

  it("names the other services that reported the Error", () => {
    render(
      <ErrorIssueList {...listProps()} issues={[{ ...issue, services: ["web", "api", "jobs"] }]} />,
    );
    expect(screen.getByTitle("web, api, jobs")).toHaveTextContent("web+2");
  });

  it("offers to clear the filters when no Error matches", async () => {
    const props = listProps();
    render(<ErrorIssueList {...props} issues={[]} />);

    expect(screen.getByText("No errors")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(props.onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("offers no clear when no page filter is set", () => {
    render(<ErrorIssueList {...listProps()} onClearFilters={undefined} issues={[]} />);

    expect(screen.getByText("No errors")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("shows the query error with a retry", async () => {
    const props = listProps();
    render(
      <ErrorIssueList {...props} issues={[]} isError={true} error={new Error("query timeout")} />,
    );

    expect(screen.getByText("Failed to load errors")).toBeInTheDocument();
    expect(screen.getByText("query timeout")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("ErrorFilters", () => {
  it("emits sort changes", async () => {
    const onChange = vi.fn();
    const repo = {
      attributeKeys: vi.fn().mockResolvedValue([]),
      attributeValues: vi.fn().mockResolvedValue([]),
    } as unknown as ErrorsRepositoryLike;
    render(
      withQueryClient(
        <ErrorFilters
          repo={repo}
          timeRange={{ from: "now-1h", to: "now" }}
          value={{
            q: "",
            service: [],
            fingerprint: "",
            sort: "lastSeen",
            attributes: [],
          }}
          onChange={onChange}
        />,
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Count" }));
    expect(onChange).toHaveBeenCalledWith({ sort: "count" });
  });
});

describe("ErrorTracePanel", () => {
  const occurrence = {
    fingerprint: "fp-1",
    timestamp: "2026-05-26 10:05:00.000000000",
    serviceName: "web",
    traceId: "trace-1",
    spanId: "span-1",
    body: "boom",
    exceptionType: "TypeError",
    exceptionMessage: "boom",
    exceptionStacktrace: "",
    resourceAttributes: {},
    logAttributes: {},
    scopeAttributes: {},
  };

  it("renders related spans via the trace-link render prop", () => {
    const spans: RelatedSpan[] = [
      { spanId: "span-1", parentSpanId: "", name: "GET /x", durationMs: 12 },
    ];
    render(
      <ErrorTracePanel
        occurrence={occurrence}
        spans={spans}
        isPending={false}
        isError={false}
        onRetry={vi.fn()}
        renderTraceLink={({ traceId, children }) => <a href={`/traces/${traceId}`}>{children}</a>}
      />,
    );
    expect(screen.getByText("Related trace")).toBeInTheDocument();
    expect(screen.getByText("GET /x")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open trace/ })).toHaveAttribute(
      "href",
      "/traces/trace-1",
    );
  });

  it("limits related trace items and marks overflow", () => {
    const spans: RelatedSpan[] = Array.from({ length: 11 }, (_, index) => ({
      spanId: `span-${index + 1}`,
      parentSpanId: "",
      name: `Span ${index + 1}`,
      durationMs: index + 1,
    }));
    render(
      <ErrorTracePanel
        occurrence={occurrence}
        spans={spans}
        isPending={false}
        isError={false}
        onRetry={vi.fn()}
        renderTraceLink={({ traceId, children }) => <a href={`/traces/${traceId}`}>{children}</a>}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(10);
    expect(screen.getByText("Span 10")).toBeInTheDocument();
    expect(screen.queryByText("Span 11")).not.toBeInTheDocument();
    expect(screen.getByText("1 more span in the trace.")).toBeInTheDocument();
  });

  it("keeps the span of the Error and its ancestors when the trace is cut", () => {
    // Twelve spans in a chain, then the failing branch at the end of the tree.
    const spans: RelatedSpan[] = [
      { spanId: "root", parentSpanId: "", name: "POST /checkout", durationMs: 90 },
      ...Array.from({ length: 12 }, (_, index) => ({
        spanId: `db-${index}`,
        parentSpanId: "root",
        name: `db query ${index}`,
        durationMs: 2,
      })),
      { spanId: "charge", parentSpanId: "root", name: "charge card", durationMs: 40 },
      { spanId: "span-1", parentSpanId: "charge", name: "provider request", durationMs: 30 },
    ];
    render(
      <ErrorTracePanel
        occurrence={occurrence}
        spans={spans}
        isPending={false}
        isError={false}
        onRetry={vi.fn()}
        renderTraceLink={({ traceId, children }) => <a href={`/traces/${traceId}`}>{children}</a>}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(10);
    expect(screen.getByText("POST /checkout")).toBeInTheDocument();
    expect(screen.getByText("charge card")).toBeInTheDocument();
    expect(screen.getByText("provider request").closest("li")).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByText("5 more spans in the trace.")).toBeInTheDocument();
  });

  it("renders nothing without a trace id", () => {
    const { container } = render(
      <ErrorTracePanel
        occurrence={{ ...occurrence, traceId: "" }}
        spans={[]}
        isPending={false}
        isError={false}
        onRetry={vi.fn()}
        renderTraceLink={() => null}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
