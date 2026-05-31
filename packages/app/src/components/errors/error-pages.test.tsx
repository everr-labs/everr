import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ErrorIssueSummary, ErrorOccurrence } from "@/data/errors/types";
import { ErrorFilters, ErrorSearchForm } from "./error-filters";
import { ErrorIssueList } from "./error-issue-list";

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

import { ErrorLatestOccurrence } from "./error-latest-occurrence";
import {
  findErrorOccurrenceByKey,
  getErrorOccurrenceKey,
} from "./error-occurrence-key";
import { ErrorOccurrencesList } from "./error-occurrences-list";
import { ErrorStacktrace } from "./error-stacktrace";
import { ErrorTracePanel } from "./error-trace-panel";
import { TraceLink } from "./trace-link";

const issue: ErrorIssueSummary = {
  fingerprint: "fp-1",
  exceptionType: "TypeError",
  exceptionMessage: "Cannot read properties of undefined",
  body: "TypeError: Cannot read properties of undefined",
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

const stacktrace =
  "TypeError: boom\n\n    at app.ts:1:1\n      at worker.ts:2:2";

const occurrence: ErrorOccurrence = {
  fingerprint: "fp-1",
  timestamp: "2026-05-26 10:05:00.000000000",
  serviceName: "web",
  traceId: "trace-1",
  spanId: "span-1",
  body: "TypeError: boom",
  exceptionType: "TypeError",
  exceptionMessage: "boom",
  exceptionStacktrace: stacktrace,
  resourceAttributes: { "service.namespace": "frontend" },
  logAttributes: { "exception.type": "TypeError" },
  scopeAttributes: { "otel.scope.name": "browser-errors" },
};

function renderWithRouter(children: ReactNode) {
  const rootRoute = createRootRoute({
    component: Outlet,
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => children,
  });
  const traceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/traces/$traceId",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, traceRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  return render(<RouterProvider router={router} />);
}

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  );
}

describe("ErrorIssueList", () => {
  it("renders grouped issue rows", () => {
    render(
      <ErrorIssueList
        issues={[issue]}
        isPending={false}
        isError={false}
        onRetry={() => {}}
        hasNextPage={false}
        isFetchingNextPage={false}
        onLoadMore={() => {}}
        renderIssueLink={({ fingerprint, children }) => (
          <a href={`/errors/${fingerprint}`}>{children}</a>
        )}
      />,
    );

    expect(screen.getByText("TypeError")).toBeInTheDocument();
    expect(
      screen.getByText("Cannot read properties of undefined"),
    ).toBeInTheDocument();
    expect(screen.getByText("3 occurrences")).toBeInTheDocument();
    expect(screen.queryByText("2 traces")).not.toBeInTheDocument();
  });

  it("renders an empty state", () => {
    render(
      <ErrorIssueList
        issues={[]}
        isPending={false}
        isError={false}
        onRetry={() => {}}
        hasNextPage={false}
        isFetchingNextPage={false}
        onLoadMore={() => {}}
        renderIssueLink={({ children }) => <span>{children}</span>}
      />,
    );

    expect(screen.getByText("No exception logs found")).toBeInTheDocument();
  });
});

describe("ErrorFilters", () => {
  const defaultValue = {
    q: "",
    service: [],
    fingerprint: "",
    sort: "lastSeen" as const,
  };

  it("renders sidebar filters without the search input", () => {
    renderWithQueryClient(
      <ErrorFilters
        value={defaultValue}
        services={["web", "api"]}
        onChange={() => {}}
      />,
    );

    const filters = screen.getByRole("complementary", {
      name: "Error filters",
    });
    expect(filters).toBeInTheDocument();
    expect(within(filters).queryByPlaceholderText("Search errors")).toBeNull();
  });

  it("submits sort changes", async () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <ErrorFilters
        value={defaultValue}
        services={["web", "api"]}
        onChange={onChange}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Count" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "count" }),
    );
  });

  it("uses the logs service filter combobox", async () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <ErrorFilters
        value={{ ...defaultValue, service: ["web"] }}
        services={["web", "api"]}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("Service")).toBeInTheDocument();
    expect(screen.getByText("web")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Service" }));
    await userEvent.click(await screen.findByText("api"));

    expect(onChange).toHaveBeenCalledWith({ service: ["web", "api"] });
  });

  it("places the service filter before the labeled order filter", () => {
    renderWithQueryClient(
      <ErrorFilters
        value={defaultValue}
        services={["web", "api"]}
        onChange={() => {}}
      />,
    );

    const serviceLabel = screen.getByText("Service");
    const orderLabel = screen.getByText("Order");

    expect(
      serviceLabel.compareDocumentPosition(orderLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole("group", { name: "Order" })).toHaveAttribute(
      "data-size",
      "lg",
    );
    expect(screen.getByRole("button", { name: "Count" })).toHaveClass(
      "bg-transparent",
    );
  });

  it("keeps stale selected service filters visible so they can be cleared", async () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <ErrorFilters
        value={{ ...defaultValue, service: ["worker"] }}
        services={["web", "api"]}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("worker")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Remove worker" }),
    );
    expect(onChange).toHaveBeenCalledWith({ service: [] });
  });
});

describe("ErrorSearchForm", () => {
  it("submits search text from the top search form", async () => {
    const onChange = vi.fn();
    render(<ErrorSearchForm value="" onChange={onChange} />);

    const searchInput = screen.getByRole("searchbox", {
      name: "Search errors",
    });
    await userEvent.type(searchInput, "boom");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(onChange).toHaveBeenCalledWith("boom");
  });

  it("syncs search draft from route state and clears it", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ErrorSearchForm value="boom" onChange={onChange} />,
    );

    const input = screen.getByRole("searchbox", { name: "Search errors" });
    expect(input).toHaveValue("boom");

    rerender(<ErrorSearchForm value="external" onChange={onChange} />);
    expect(input).toHaveValue("external");

    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(input).toHaveValue("");
    expect(onChange).toHaveBeenCalledWith("");
  });
});

describe("error detail components", () => {
  it("builds stable occurrence navigation keys", () => {
    expect(getErrorOccurrenceKey(occurrence)).toBe(
      "2026-05-26 10:05:00.000000000|trace-1|span-1",
    );
  });

  it("selects an occurrence by key and falls back to the latest occurrence", () => {
    const olderOccurrence = {
      ...occurrence,
      timestamp: "2026-05-26 10:01:00.000000000",
      traceId: "trace-older",
      spanId: "span-older",
    };
    const occurrences = [occurrence, olderOccurrence];

    expect(
      findErrorOccurrenceByKey(
        occurrences,
        getErrorOccurrenceKey(olderOccurrence),
      ),
    ).toBe(olderOccurrence);
    expect(findErrorOccurrenceByKey(occurrences, "stale-key")).toBe(occurrence);
    expect(findErrorOccurrenceByKey(occurrences, "")).toBe(occurrence);
  });

  it("renders latest occurrence metadata and attributes", () => {
    render(<ErrorLatestOccurrence occurrence={occurrence} />);
    expect(screen.getByText("web")).toBeInTheDocument();
    expect(screen.getByText("trace-1")).toBeInTheDocument();
    expect(screen.getByText("Resource attributes")).toBeInTheDocument();
  });

  it("renders stacktrace when present", () => {
    const { container } = render(
      <ErrorStacktrace stacktrace={occurrence.exceptionStacktrace} />,
    );
    expect(container.querySelector("code")?.textContent).toBe(stacktrace);
  });

  it("renders related trace spans with the error span highlighted", async () => {
    renderWithRouter(
      <ErrorTracePanel
        occurrence={occurrence}
        isPending={false}
        isError={false}
        onRetry={() => {}}
        spans={[
          {
            spanId: "root-span",
            parentSpanId: "",
            name: "GET /checkout",
            startTime: 1000,
            endTime: 1250,
            duration: 250,
            conclusion: "error",
          },
          {
            spanId: "span-1",
            parentSpanId: "root-span",
            name: "createCheckoutSession",
            startTime: 1050,
            endTime: 1200,
            duration: 150,
            conclusion: "boom",
          },
        ]}
      />,
    );

    expect(await screen.findByText("Related trace")).toBeInTheDocument();
    expect(screen.getByText("GET /checkout")).toBeInTheDocument();
    expect(screen.getByText("createCheckoutSession")).toBeInTheDocument();
    expect(screen.getByText("error span")).toBeInTheDocument();
  });

  it("does not render the related trace panel without a trace id", async () => {
    renderWithRouter(
      <ErrorTracePanel
        occurrence={{ ...occurrence, traceId: "", spanId: "" }}
        isPending={false}
        isError={false}
        onRetry={() => {}}
        spans={[]}
      />,
    );

    await expect(
      screen.findByText(
        "No spans were found for this trace.",
        {},
        { timeout: 50 },
      ),
    ).rejects.toThrow();
    expect(screen.queryByText("Related trace")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open trace" })).toBeNull();
  });

  it("omits trace actions from the occurrences list", () => {
    render(<ErrorOccurrencesList occurrences={[occurrence]} />);
    expect(screen.queryByText("Open trace")).not.toBeInTheDocument();
  });

  it("renders occurrence navigation and marks the selected occurrence", () => {
    const olderOccurrence = {
      ...occurrence,
      timestamp: "2026-05-26 10:01:00.000000000",
      traceId: "trace-older",
      spanId: "span-older",
    };

    render(
      <ErrorOccurrencesList
        occurrences={[occurrence, olderOccurrence]}
        selectedOccurrenceKey={getErrorOccurrenceKey(olderOccurrence)}
        renderOccurrenceLink={({ occurrence: item, children, isSelected }) => (
          <a
            href={`/errors/fp-1?occurrence=${getErrorOccurrenceKey(item)}`}
            aria-current={isSelected ? "page" : undefined}
          >
            {children}
          </a>
        )}
      />,
    );

    expect(screen.getByRole("link", { name: "Selected" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "View" })).toHaveAttribute(
      "href",
      "/errors/fp-1?occurrence=2026-05-26 10:05:00.000000000|trace-1|span-1",
    );
  });

  it("builds trace links with focused span and narrow window", async () => {
    renderWithRouter(<TraceLink occurrence={occurrence} />);
    const link = await screen.findByRole("link", { name: "Open trace" });
    const href = link.getAttribute("href");
    expect(href).toBeTruthy();
    const url = new URL(href ?? "", "http://localhost");

    expect(url.pathname).toBe("/traces/trace-1");
    expect(url.searchParams.get("span")).toBe("span-1");
    expect(url.searchParams.get("start")).toBe("2026-05-26 10:00:00.000");
    expect(url.searchParams.get("end")).toBe("2026-05-26 10:10:00.000");
  });
});
