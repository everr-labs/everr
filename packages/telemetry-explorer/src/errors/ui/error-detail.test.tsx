import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import type { SessionRecordingsHost } from "../../recordings/host";
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

function renderDetail(
  selectedKey = "",
  recordings: {
    withRecording?: boolean;
    sessionRecordings?: SessionRecordingsHost;
    issue?: ErrorIssueDetail;
  } = {},
) {
  const repo = {
    getIssue: vi.fn().mockResolvedValue(recordings.issue ?? detail),
  } as unknown as ErrorsRepositoryLike;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ErrorDetail
        repo={repo}
        fingerprint="fp-1"
        timeRange={{ from: "now-1h", to: "now" }}
        service={[]}
        withRecording={recordings.withRecording ?? false}
        sessionRecordings={recordings.sessionRecordings}
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
  return repo;
}

describe("ErrorDetail", () => {
  it("shows the Error, then the latest occurrence with its stack trace and attributes", async () => {
    renderDetail();

    expect(await screen.findByRole("heading", { level: 1, name: "TypeError" })).toBeInTheDocument();
    const header = screen.getByRole("banner");
    expect(within(header).getByText("Cannot read properties of undefined")).toBeInTheDocument();
    expect(within(header).getByText("312")).toBeInTheDocument();
    expect(within(header).getByText("40")).toBeInTheDocument();
    expect(screen.getByText("Occurrence 1 of 2")).toBeInTheDocument();
    // 312 occurrences are in the range and the page loaded two of them.
    expect(screen.getByText("latest 2 of 312")).toBeInTheDocument();

    // Steps to an older occurrence through a link and stops at the ends.
    const pager = screen.getByRole("navigation", { name: "Occurrences" });
    expect(within(pager).getByRole("button", { name: "Newer occurrence" })).toBeDisabled();
    expect(within(pager).getByRole("link", { name: "Older occurrence" })).toHaveAttribute(
      "href",
      `?occurrence=${encodeURIComponent(getErrorOccurrenceKey(older))}`,
    );

    // The stack trace stays as the runtime wrote it.
    const stack = screen.getByText(
      /at renderRow \(http:\/\/localhost:5173\/src\/list\.tsx:42:13\)/,
    );
    expect(stack.tagName).toBe("CODE");
    expect(stack).toHaveTextContent("TypeError: Cannot read properties of undefined");
    expect(stack).toHaveTextContent("at commitRoot");

    // Attributes are listed by source, without the ones shown above.
    const log = screen.getByRole("region", { name: "Log attributes" });
    expect(within(log).getByText("http.route")).toBeInTheDocument();
    expect(within(log).getByText("/users/:id")).toBeInTheDocument();
    expect(within(log).queryByText("exception.stacktrace")).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Resource attributes" })).getByText("1.4.2"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Scope attributes" })).not.toBeInTheDocument();
  });

  it("shows the occurrence that the search param selects", async () => {
    renderDetail(getErrorOccurrenceKey(older));

    expect(await screen.findByText("Occurrence 2 of 2")).toBeInTheDocument();
    expect(screen.getByText("Cannot read properties of null")).toBeInTheDocument();
    expect(screen.getByText("/orders/:id")).toBeInTheDocument();
    const pager = screen.getByRole("navigation", { name: "Occurrences" });
    expect(within(pager).getByRole("button", { name: "Older occurrence" })).toBeDisabled();
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

describe("ErrorDetail session recording", () => {
  const STREAM = "0123456789abcdef";
  const recorded = occurrence({
    logAttributes: { "exception.type": "TypeError", "everr.recording.stream.id": STREAM },
  });
  const withPlayer = (): SessionRecordingsHost => ({
    renderPlayer: vi.fn((subject) => (
      <section aria-label="Session recording">{subject.kind}</section>
    )),
  });

  it("draws the player for a browser occurrence first, keyed to its stream and instant", async () => {
    const host = withPlayer();
    renderDetail("", {
      sessionRecordings: host,
      issue: { ...detail, latest: recorded, occurrences: [recorded, older] },
    });

    const player = await screen.findByRole("region", { name: "Session recording" });
    expect(host.renderPlayer).toHaveBeenLastCalledWith(
      { kind: "log", streamId: STREAM, at: recorded.timestamp },
      "inline",
    );
    const stack = screen.getByText(/at renderRow/);
    expect(player.compareDocumentPosition(stack)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("reaches the recording through the trace of an occurrence without a stream", async () => {
    const host = withPlayer();
    renderDetail(getErrorOccurrenceKey(older), { sessionRecordings: host });

    await screen.findByText("Occurrence 2 of 2");
    expect(host.renderPlayer).toHaveBeenLastCalledWith(
      { kind: "trace", traceId: older.traceId },
      "inline",
    );
  });

  it("draws no player for an occurrence with neither a stream nor a trace", async () => {
    const host = withPlayer();
    const bare = occurrence({ traceId: "" });
    renderDetail("", {
      sessionRecordings: host,
      issue: { ...detail, latest: bare, occurrences: [bare] },
    });

    await screen.findByText("Occurrence 1 of 1");
    expect(host.renderPlayer).not.toHaveBeenCalled();
  });

  it("scopes the occurrences to recorded ones only when the host has recordings", async () => {
    const scoped = renderDetail("", { withRecording: true, sessionRecordings: withPlayer() });
    await screen.findByText("Occurrence 1 of 2");
    expect(scoped.getIssue).toHaveBeenCalledWith(expect.objectContaining({ withRecording: true }));
    cleanup();

    const unscoped = renderDetail("", { withRecording: true });
    await screen.findByText("Occurrence 1 of 2");
    expect(unscoped.getIssue).toHaveBeenCalledWith(
      expect.objectContaining({ withRecording: false }),
    );
  });
});
