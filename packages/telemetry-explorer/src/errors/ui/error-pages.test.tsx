import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ErrorIssueSummary, RelatedSpan } from "../data/types";

function withQueryClient(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

vi.mock("react-virtuoso", () => ({
  Virtuoso: <T,>({
    data,
    itemContent,
    components,
  }: {
    data: T[];
    itemContent: (index: number, item: T) => React.ReactNode;
    components?: { Footer?: () => React.ReactNode };
  }) => {
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
};

function listProps() {
  return {
    isPending: false,
    isError: false,
    onRetry: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    onLoadMore: vi.fn(),
    renderIssueLink: ({
      fingerprint,
      children,
    }: {
      fingerprint: string;
      children: ReactNode;
    }) => <a href={`/errors/${fingerprint}`}>{children}</a>,
  };
}

describe("ErrorIssueList", () => {
  it("renders grouped issue rows", () => {
    render(<ErrorIssueList {...listProps()} issues={[issue]} />);
    expect(screen.getByText("TypeError")).toBeInTheDocument();
    expect(screen.getByText("3 occurrences")).toBeInTheDocument();
  });

  it("renders the empty state", () => {
    render(<ErrorIssueList {...listProps()} issues={[]} />);
    expect(screen.getByText("No exception logs found")).toBeInTheDocument();
  });
});

describe("ErrorFilters", () => {
  it("emits sort changes", async () => {
    const onChange = vi.fn();
    render(
      withQueryClient(
        <ErrorFilters
          value={{ q: "", service: [], fingerprint: "", sort: "lastSeen" }}
          services={["web", "api"]}
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
        renderTraceLink={({ traceId, children }) => (
          <a href={`/traces/${traceId}`}>{children}</a>
        )}
      />,
    );
    expect(screen.getByText("Related trace")).toBeInTheDocument();
    expect(screen.getByText("GET /x")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open trace/ })).toHaveAttribute(
      "href",
      "/traces/trace-1",
    );
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
