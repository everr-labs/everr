import {
  type ErrorIssueSearch,
  ErrorIssueSearchSchema,
} from "@everr/telemetry-explorer/errors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@/lib/clickhouse";
import { ErrorDetailRouteContent } from "./-error-detail";

vi.mock("@/data/runs/options", () => ({
  runSpansOptions: () => ({
    queryKey: ["runs", "spans", "test"],
    queryFn: async () => [],
  }),
}));

const replays: Array<{ pauses: Array<number | undefined> }> = [];

vi.mock("@rrweb/replay", () => ({
  Replayer: class {
    pauses: Array<number | undefined> = [];
    wrapper = document.createElement("div");
    iframe = document.createElement("iframe");
    constructor() {
      Object.defineProperty(this.iframe, "offsetWidth", { value: 800 });
      Object.defineProperty(this.iframe, "offsetHeight", { value: 600 });
      replays.push(this);
    }
    pause(at?: number) {
      this.pauses.push(at);
    }
    play() {}
    getCurrentTime() {
      return 0;
    }
    on() {}
    destroy() {}
  },
}));

vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data: unknown[];
    itemContent: (index: number, item: unknown) => ReactNode;
  }) => (
    <div>
      {data.map((item, index) => (
        <div key={index}>{itemContent(index, item)}</div>
      ))}
    </div>
  ),
}));

const ROOT_MS = Date.UTC(2026, 9, 17, 12, 0, 0);
const LOG_MS = ROOT_MS + 5_000;
const FIRST_EVENT_MS = ROOT_MS;

type Occurrence = {
  timestampRank: number;
  fingerprint: string;
  timestamp: string;
  serviceName: string;
  traceId: string;
  spanId: string;
  body: string;
  exceptionType: string;
  exceptionMessage: string;
  exceptionStacktrace: string;
  resourceAttributes: Record<string, unknown>;
  logAttributes: Record<string, unknown>;
  scopeAttributes: Record<string, unknown>;
};

function occurrence(input: {
  spanId?: string;
  serviceName?: string;
  attributes?: Record<string, string>;
  timestampMs?: number;
}): Occurrence {
  const timestampMs = input.timestampMs ?? LOG_MS;
  return {
    timestampRank: 1,
    fingerprint: "fp-1",
    timestamp: new Date(timestampMs)
      .toISOString()
      .replace("T", " ")
      .replace("Z", "000000"),
    serviceName: input.serviceName ?? "shop-web",
    traceId: "trace-1",
    spanId: input.spanId ?? "",
    body: "PaymentError: card declined",
    exceptionType: "PaymentError",
    exceptionMessage: "card declined",
    exceptionStacktrace:
      "PaymentError: card declined\n    at pay (cart.ts:42:7)",
    resourceAttributes: {},
    logAttributes: input.attributes ?? {},
    scopeAttributes: {},
  };
}

function rawSpan(input: {
  spanId: string;
  parentSpanId?: string;
  serviceName?: string;
  spanKind?: string;
  timestampMs: number;
  durationMs: number;
  attributes?: Record<string, string>;
}) {
  return {
    traceId: "trace-1",
    spanId: input.spanId,
    parentSpanId: input.parentSpanId ?? "",
    spanName: input.spanId,
    serviceName: input.serviceName ?? "shop-web",
    serviceNamespace: "",
    timestamp: new Date(input.timestampMs)
      .toISOString()
      .replace("T", " ")
      .replace("Z", ""),
    timestampNs: (BigInt(input.timestampMs) * 1_000_000n).toString(),
    duration: (BigInt(input.durationMs) * 1_000_000n).toString(),
    statusCode: "Ok",
    spanKind: input.spanKind ?? "Client",
    spanAttributes: input.attributes ?? {},
    resourceAttributes: {},
    eventNames: [],
    eventTimestamps: [],
    eventAttributes: [],
    linkTraceIds: [],
    linkSpanIds: [],
    linkAttributes: [],
  };
}

function recordingRow(input: {
  clipId: string;
  startMs: number;
  durationMs: number;
}) {
  return {
    traceId: "trace-clip",
    spanId: input.clipId,
    startTs: new Date(input.startMs)
      .toISOString()
      .replace("T", " ")
      .replace("Z", ""),
    startNs: (BigInt(input.startMs) * 1_000_000n).toString(),
    durationNs: (BigInt(input.durationMs) * 1_000_000n).toString(),
    clipId: input.clipId,
    trigger: "manual",
    truncated: "",
  };
}

const db = {
  occurrences: [] as Occurrence[],
  spans: [] as ReturnType<typeof rawSpan>[],
  covering: [] as ReturnType<typeof recordingRow>[],
  sessionClips: [] as ReturnType<typeof recordingRow>[],
  segments: [] as Array<{ body: string; segmentIndex: string }>,
};

const calls: Array<{
  sql: string;
  params: Record<string, unknown> | undefined;
}> = [];

const summary = {
  fingerprint: "fp-1",
  exceptionType: "PaymentError",
  exceptionMessage: "card declined",
  body: "PaymentError: card declined",
  latestServiceName: "shop-web",
  services: ["shop-web"],
  occurrenceCount: 1,
  traceCount: 1,
  firstSeen: "2026-10-17 12:00:05.000000000",
  lastSeen: "2026-10-17 12:00:05.000000000",
  latestTraceId: "trace-1",
  latestSpanId: "click",
  latestTimestamp: "2026-10-17 12:00:05.000000000",
};

function renderError(search: Partial<ErrorIssueSearch> = {}) {
  const parsed = ErrorIssueSearchSchema.parse({
    from: "2026-10-17 11:00:00.000",
    to: "2026-10-17 13:00:00.000",
    ...search,
  });
  const root = createRootRoute();
  const detail = createRoute({
    getParentRoute: () => root,
    path: "/errors/$fingerprint",
    component: () => (
      <ErrorDetailRouteContent
        fingerprint="fp-1"
        search={parsed}
        detailTo="/errors/$fingerprint"
      />
    ),
  });
  const trace = createRoute({
    getParentRoute: () => root,
    path: "/traces/$traceId",
    component: () => null,
  });
  const router = createRouter({
    routeTree: root.addChildren([detail, trace]),
    history: createMemoryHistory({ initialEntries: ["/errors/fp-1"] }),
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  replays.length = 0;
  calls.length = 0;
  db.occurrences = [];
  db.spans = [];
  db.covering = [];
  db.sessionClips = [];
  db.segments = [];
  vi.stubGlobal(
    "Worker",
    class {
      constructor() {
        throw new Error("workers are unavailable in this test");
      }
    },
  );
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.mocked(query).mockImplementation(
    async (
      sql: string,
      _tenant?: unknown,
      params?: Record<string, unknown>,
    ) => {
      calls.push({ sql: String(sql), params });
      const text = String(sql);
      if (text.includes("ranked_occurrence_rows")) return db.occurrences;
      if (text.includes("exception_logs AS")) return [summary];
      if (text.includes("SpanKind")) return db.spans;
      if (text.includes("as startTime")) return [];
      if (text.includes("FROM recordings")) return db.segments;
      if (text.includes("everr.recording.stream.id")) return db.covering;
      if (text.includes("SpanName = 'recording'")) return db.sessionClips;
      return [];
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("error replay player", () => {
  it("opens on the span carrying the exception log and keeps the stack", async () => {
    db.occurrences = [
      occurrence({
        spanId: "click",
        attributes: {
          "session.id": "sess-1",
          "everr.recording.stream.id": "stream-1",
        },
      }),
    ];
    db.spans = [
      rawSpan({
        spanId: "click",
        serviceName: "shop-web",
        timestampMs: ROOT_MS + 4_000,
        durationMs: 500,
      }),
    ];
    db.covering = [
      recordingRow({
        clipId: "clip-1",
        startMs: ROOT_MS - 2_000,
        durationMs: 20_000,
      }),
    ];
    db.segments = [
      {
        segmentIndex: "0",
        body: JSON.stringify([
          { type: 2, timestamp: FIRST_EVENT_MS, data: {} },
        ]),
      },
    ];
    renderError();

    expect(
      await screen.findByRole("region", { name: "Replay" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/at pay \(cart\.ts:42:7\)/)).toBeInTheDocument();
    await waitFor(() => expect(replays.length).toBeGreaterThan(0));
    expect(replays[0]?.pauses).toContain(4_000);

    const choice = calls.filter((call) =>
      call.sql.includes("everr.recording.stream.id"),
    );
    expect(choice[0]?.params).toMatchObject({
      sessionId: "sess-1",
      streamId: "stream-1",
      entryTs: "2026-10-17 12:00:04.000",
    });
    const segments = calls.filter((call) =>
      call.sql.includes("FROM recordings"),
    );
    expect(segments[0]?.params).toMatchObject({
      service: "shop-web",
      sessionId: "sess-1",
      clipId: "clip-1",
    });
  });

  it("asks for the Clip once under a relative time range", async () => {
    db.occurrences = [
      occurrence({
        spanId: "click",
        attributes: {
          "session.id": "sess-1",
          "everr.recording.stream.id": "stream-1",
        },
      }),
    ];
    db.spans = [
      rawSpan({
        spanId: "click",
        serviceName: "shop-web",
        timestampMs: ROOT_MS + 4_000,
        durationMs: 500,
      }),
    ];
    db.covering = [
      recordingRow({
        clipId: "clip-1",
        startMs: ROOT_MS - 2_000,
        durationMs: 20_000,
      }),
    ];
    db.segments = [
      {
        segmentIndex: "0",
        body: JSON.stringify([
          { type: 2, timestamp: FIRST_EVENT_MS, data: {} },
        ]),
      },
    ];
    // The error list's default range. Resolving it against the clock on
    // every render gave the replay query a new key each time.
    renderError({ from: "now-7d", to: "now" });

    await waitFor(() => expect(replays.length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 200));

    const choice = calls.filter((call) =>
      call.sql.includes("everr.recording.stream.id"),
    );
    expect(choice).toHaveLength(1);
    // The server bounds the scan from the entry; no list range reaches it.
    expect(choice[0]?.params).toEqual({
      sessionId: "sess-1",
      streamId: "stream-1",
      entryTs: "2026-10-17 12:00:04.000",
    });
  });

  it("opens at the log timestamp when the exception log has no span id", async () => {
    db.occurrences = [
      occurrence({
        attributes: {
          "session.id": "sess-1",
          "everr.recording.stream.id": "stream-1",
        },
      }),
    ];
    db.covering = [
      recordingRow({
        clipId: "clip-1",
        startMs: ROOT_MS - 2_000,
        durationMs: 20_000,
      }),
    ];
    db.segments = [
      {
        segmentIndex: "0",
        body: JSON.stringify([
          { type: 2, timestamp: FIRST_EVENT_MS, data: {} },
        ]),
      },
    ];
    renderError();

    await waitFor(() => expect(replays.length).toBeGreaterThan(0));
    expect(replays[0]?.pauses).toContain(5_000);
    expect(calls.some((call) => call.sql.includes("SpanKind"))).toBe(false);
    const choice = calls.filter((call) =>
      call.sql.includes("everr.recording.stream.id"),
    );
    expect(choice[0]?.params).toMatchObject({
      entryTs: "2026-10-17 12:00:05.000000000",
    });
  });

  it("takes the session and browser service from the trace for a backend error", async () => {
    db.occurrences = [occurrence({ serviceName: "api" })];
    db.spans = [
      rawSpan({
        spanId: "call",
        serviceName: "shop-web",
        timestampMs: ROOT_MS - 500,
        durationMs: 8_000,
        attributes: {
          "session.id": "sess-1",
          "everr.recording.stream.id": "stream-1",
        },
      }),
    ];
    db.covering = [
      recordingRow({
        clipId: "clip-1",
        startMs: ROOT_MS - 2_000,
        durationMs: 20_000,
      }),
    ];
    db.segments = [
      {
        segmentIndex: "0",
        body: JSON.stringify([
          { type: 2, timestamp: FIRST_EVENT_MS, data: {} },
        ]),
      },
    ];
    renderError();

    expect(
      await screen.findByRole("region", { name: "Replay" }),
    ).toBeInTheDocument();
    const choice = calls.filter((call) =>
      call.sql.includes("everr.recording.stream.id"),
    );
    expect(choice[0]?.params).toMatchObject({
      sessionId: "sess-1",
      streamId: "stream-1",
      entryTs: "2026-10-17 12:00:05.000000000",
    });
    const segments = calls.filter((call) =>
      call.sql.includes("FROM recordings"),
    );
    expect(segments[0]?.params).toMatchObject({ service: "shop-web" });
  });

  it("has no player when neither the log nor the trace has a session", async () => {
    db.occurrences = [occurrence({ serviceName: "api" })];
    db.spans = [
      rawSpan({
        spanId: "call",
        serviceName: "api",
        spanKind: "Server",
        timestampMs: ROOT_MS - 500,
        durationMs: 8_000,
      }),
    ];
    renderError();

    expect(
      await screen.findByText(/PaymentError: card declined/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Replay" }),
    ).not.toBeInTheDocument();
    expect(
      calls.some((call) => call.sql.includes("SpanName = 'recording'")),
    ).toBe(false);
  });
});
