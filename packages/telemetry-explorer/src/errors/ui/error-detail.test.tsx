import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import type { ErrorsRepositoryLike } from "../data/repository";
import type { ErrorIssueDetail, ErrorOccurrence } from "../data/types";
import { ErrorAttributes } from "./error-attributes";
import { ErrorDetail } from "./error-detail";
import { getErrorOccurrenceKey } from "./error-occurrence-key";

function occurrence(overrides: Partial<ErrorOccurrence>): ErrorOccurrence {
  return {
    timestampRank: 1,
    fingerprint: "fp-1",
    timestamp: "2026-05-26 10:05:00.000000000",
    serviceName: "web",
    traceId: "0123456789abcdef0123456789abcdef",
    spanId: "0123456789abcdef",
    body: "boom",
    exceptionType: "TypeError",
    exceptionMessage: "Cannot read properties of undefined",
    exceptionStacktrace: [
      "TypeError: Cannot read properties of undefined",
      "    at renderRow (http://localhost:5173/src/list.tsx:42:13)",
      "    at commitRoot (http://localhost:5173/node_modules/react-dom/index.js:1:1)",
      "    at flushSync (http://localhost:5173/node_modules/react-dom/index.js:2:1)",
      "    at performWork (http://localhost:5173/node_modules/scheduler/index.js:3:1)",
    ].join("\n"),
    resourceAttributes: { "service.version": "1.4.2" },
    logAttributes: {
      "exception.type": "TypeError",
      "exception.stacktrace": "TypeError: ...",
      "http.route": "/users/:id",
    },
    scopeAttributes: {},
    ...overrides,
  };
}

const latest = occurrence({});
const older = occurrence({
  timestamp: "2026-05-26 10:01:00.000000000",
  exceptionMessage: "Cannot read properties of null",
  logAttributes: { "http.route": "/orders/:id" },
});

const detail: ErrorIssueDetail = {
  summary: {
    fingerprint: "fp-1",
    exceptionType: "TypeError",
    exceptionMessage: "Cannot read properties of undefined",
    body: "boom",
    latestServiceName: "web",
    services: ["web"],
    occurrenceCount: 312,
    traceCount: 40,
    firstSeen: "2026-05-23 10:00:00.000000000",
    lastSeen: "2026-05-26 10:05:00.000000000",
    latestTraceId: latest.traceId,
    latestSpanId: latest.spanId,
    latestTimestamp: latest.timestamp,
    trend: [0, 3, 1],
  },
  latest,
  occurrences: [latest, older],
};

function renderDetail(selectedKey = "") {
  const repo = {
    getIssue: vi.fn().mockResolvedValue(detail),
  } as unknown as ErrorsRepositoryLike;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ErrorDetail
        repo={repo}
        fingerprint="fp-1"
        timeRange={{ from: "now-1h", to: "now" }}
        refresh="off"
        service={[]}
        occurrence={selectedKey}
        renderOccurrenceLink={({ occurrence: linked, label, className, children }) => (
          <a
            href={`?occurrence=${encodeURIComponent(getErrorOccurrenceKey(linked))}`}
            aria-label={label}
            className={className}
          >
            {children}
          </a>
        )}
      />
    </QueryClientProvider>,
  );
}

describe("ErrorDetail", () => {
  it("shows the Error, then the latest occurrence, with the group counts", async () => {
    renderDetail();

    expect(await screen.findByRole("heading", { level: 1, name: "TypeError" })).toBeInTheDocument();
    const header = screen.getByRole("banner");
    expect(within(header).getByText("Cannot read properties of undefined")).toBeInTheDocument();
    expect(within(header).getByText("312")).toBeInTheDocument();
    expect(within(header).getByText("40")).toBeInTheDocument();
    expect(screen.getByText("Occurrence 1 of 2")).toBeInTheDocument();
    // 312 occurrences are in the range and the page loaded two of them.
    expect(screen.getByText("latest 2 of 312")).toBeInTheDocument();
  });

  it("steps to an older occurrence through a link and stops at the ends", async () => {
    renderDetail();

    const pager = await screen.findByRole("navigation", { name: "Occurrences" });
    expect(within(pager).getByRole("button", { name: "Newer occurrence" })).toBeDisabled();
    expect(within(pager).getByRole("link", { name: "Older occurrence" })).toHaveAttribute(
      "href",
      `?occurrence=${encodeURIComponent(getErrorOccurrenceKey(older))}`,
    );
  });

  it("shows the occurrence that the search param selects", async () => {
    renderDetail(getErrorOccurrenceKey(older));

    expect(await screen.findByText("Occurrence 2 of 2")).toBeInTheDocument();
    expect(screen.getByText("Cannot read properties of null")).toBeInTheDocument();
    expect(screen.getByText("/orders/:id")).toBeInTheDocument();
    const pager = screen.getByRole("navigation", { name: "Occurrences" });
    expect(within(pager).getByRole("button", { name: "Older occurrence" })).toBeDisabled();
  });

  it("shows the stack trace as the runtime wrote it", async () => {
    renderDetail();

    const stack = await screen.findByText(
      /at renderRow \(http:\/\/localhost:5173\/src\/list\.tsx:42:13\)/,
    );
    expect(stack.tagName).toBe("CODE");
    expect(stack).toHaveTextContent("TypeError: Cannot read properties of undefined");
    expect(stack).toHaveTextContent("at commitRoot");
  });

  it("lists the attributes by source, without the ones shown above", async () => {
    renderDetail();

    const log = await screen.findByRole("region", { name: "Log attributes" });
    expect(within(log).getByText("http.route")).toBeInTheDocument();
    expect(within(log).getByText("/users/:id")).toBeInTheDocument();
    expect(within(log).queryByText("exception.stacktrace")).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Resource attributes" })).getByText("1.4.2"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Scope attributes" })).not.toBeInTheDocument();
  });

  it("ignores an attribute filter that the next occurrence has no field for", async () => {
    const many = occurrence({
      resourceAttributes: Object.fromEntries(
        Array.from({ length: 8 }, (_, index) => [`resource.key.${index}`, `value-${index}`]),
      ),
    });
    const { rerender } = render(<ErrorAttributes occurrence={many} />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Filter attributes" }), "nothing");
    expect(screen.getByText("No attribute matches “nothing”.")).toBeInTheDocument();

    // The pager keeps the component mounted, so the typed value stays in state.
    rerender(<ErrorAttributes occurrence={older} />);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByText("/orders/:id")).toBeInTheDocument();
  });
});
