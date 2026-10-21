import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@/lib/clickhouse";
import { Route } from "./traces_.$traceId";

type Replay = {
  events: unknown;
  pauses: Array<number | undefined>;
  plays: Array<number | undefined>;
  time: number;
};

const replays: Replay[] = [];
const frames: FrameRequestCallback[] = [];
let holdFrames = false;

vi.mock("@rrweb/replay", () => ({
  Replayer: class {
    events: unknown;
    pauses: Array<number | undefined> = [];
    plays: Array<number | undefined> = [];
    time = 0;
    wrapper = document.createElement("div");
    iframe = document.createElement("iframe");
    constructor(events: unknown) {
      this.events = events;
      Object.defineProperty(this.iframe, "offsetWidth", { value: 800 });
      Object.defineProperty(this.iframe, "offsetHeight", { value: 600 });
      replays.push(this);
    }
    pause(at?: number) {
      if (typeof at === "number") this.time = at;
      this.pauses.push(at);
    }
    play(at?: number) {
      if (typeof at === "number") this.time = at;
      this.plays.push(at);
    }
    getCurrentTime() {
      return this.time;
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
const ENTRY_MS = ROOT_MS + 5_000;
const PAY_MS = ROOT_MS + 8_000;
const FIRST_EVENT_MS = ROOT_MS - 1_000;

type RawSpan = Record<string, unknown>;

function rawSpan(input: {
  spanId: string;
  parentSpanId?: string;
  serviceName?: string;
  spanKind?: string;
  timestampMs: number;
  durationMs: number;
  attributes?: Record<string, string>;
}): RawSpan {
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
  traceId: string;
  startMs: number;
  durationMs: number;
  trigger?: string;
  truncated?: boolean;
}) {
  return {
    traceId: input.traceId,
    spanId: input.clipId,
    startTs: new Date(input.startMs)
      .toISOString()
      .replace("T", " ")
      .replace("Z", ""),
    startNs: (BigInt(input.startMs) * 1_000_000n).toString(),
    durationNs: (BigInt(input.durationMs) * 1_000_000n).toString(),
    clipId: input.clipId,
    trigger: input.trigger ?? "manual",
    truncated: input.truncated ? "true" : "",
  };
}

const browserEntry = rawSpan({
  spanId: "click",
  parentSpanId: "root",
  serviceName: "shop-web",
  timestampMs: ENTRY_MS,
  durationMs: 100,
  attributes: {
    "session.id": "sess-1",
    "everr.recording.stream.id": "stream-1",
  },
});

const calls: Array<{
  sql: string;
  params: Record<string, unknown> | undefined;
}> = [];

type RawLog = {
  spanId: string;
  timestamp: string;
  timestampNs: string;
  severityNumber: string | number;
  severityText: string;
  body: string;
  eventName: string;
  exceptionType: string;
  exceptionMessage: string;
};

function rawLog(input: {
  spanId: string;
  timestampMs: number;
  severityNumber?: number;
  severityText?: string;
  body: string;
  eventName?: string;
  exceptionType?: string;
  exceptionMessage?: string;
}): RawLog {
  return {
    spanId: input.spanId,
    timestamp: new Date(input.timestampMs)
      .toISOString()
      .replace("T", " ")
      .replace("Z", ""),
    timestampNs: (BigInt(input.timestampMs) * 1_000_000n).toString(),
    severityNumber: input.severityNumber ?? 9,
    severityText: input.severityText ?? "INFO",
    body: input.body,
    eventName: input.eventName ?? "",
    exceptionType: input.exceptionType ?? "",
    exceptionMessage: input.exceptionMessage ?? "",
  };
}

const db = {
  spans: [] as RawSpan[],
  logs: [] as RawLog[],
  covering: [] as ReturnType<typeof recordingRow>[],
  sessionClips: [] as ReturnType<typeof recordingRow>[],
  segments: [] as Array<{ body: string; segmentIndex: string }>,
};

function renderTrace(
  search = "span=click&start=2026-10-17%2012:00:00.000&end=2026-10-17%2012:00:20.000",
) {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.spyOn(Route, "useParams").mockReturnValue({ traceId: "trace-1" });
  vi.spyOn(Route, "useSearch").mockImplementation(() =>
    useSearch({ strict: false }),
  );
  vi.spyOn(Route, "useNavigate").mockImplementation(() => useNavigate());
  const root = createRootRoute();
  const trace = createRoute({
    getParentRoute: () => root,
    path: "/traces/$traceId",
    validateSearch: (value: Record<string, unknown>) => ({
      span: value.span as string | undefined,
      start: value.start as string | undefined,
      end: value.end as string | undefined,
      from: value.from as string | undefined,
      to: value.to as string | undefined,
    }),
    component: Route.options.component,
  });
  const router = createRouter({
    routeTree: root.addChildren([trace]),
    history: createMemoryHistory({
      initialEntries: [`/traces/trace-1?${search}`],
    }),
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
  frames.length = 0;
  calls.length = 0;
  holdFrames = false;
  db.spans = [];
  db.logs = [];
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
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    if (!holdFrames) {
      callback(0);
      return 0;
    }
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  vi.mocked(query).mockImplementation(
    async (
      sql: string,
      _tenant?: unknown,
      params?: Record<string, unknown>,
    ) => {
      calls.push({ sql: String(sql), params });
      const text = String(sql);
      if (text.includes("FROM recordings")) return db.segments;
      if (text.includes("FROM logs")) return db.logs;
      if (text.includes("everr.recording.stream.id")) return db.covering;
      if (text.includes("SpanName = 'recording'")) {
        if (text.includes("Timestamp BETWEEN")) {
          return db.sessionClips.filter(
            (row) =>
              row.startTs >= String(params?.fromTs) &&
              row.startTs <= String(params?.toTs),
          );
        }
        return db.sessionClips;
      }
      if (text.includes("TraceId =")) return db.spans;
      return [];
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("trace replay player", () => {
  it("uses the same rrweb replay package version as the recorder", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const appPkg = JSON.parse(
      readFileSync(
        resolve(here, "../../../../../../../..", "package.json"),
        "utf8",
      ),
    ) as { dependencies: Record<string, string> };
    const recorderPkg = JSON.parse(
      readFileSync(
        resolve(here, "../../../../../../../../..", "otel-web/package.json"),
        "utf8",
      ),
    ) as { dependencies: Record<string, string> };
    expect(appPkg.dependencies["@rrweb/replay"]).toBe("2.1.7");
    expect(appPkg.dependencies["@rrweb/replay"]).toBe(
      recorderPkg.dependencies["@rrweb/record"],
    );
  });

  it("shows no player when the entry has no session", async () => {
    db.spans = [
      rawSpan({
        spanId: "root",
        serviceName: "api",
        timestampMs: ROOT_MS,
        durationMs: 20_000,
      }),
      rawSpan({
        spanId: "click",
        parentSpanId: "root",
        spanKind: "Internal",
        timestampMs: ENTRY_MS,
        durationMs: 100,
      }),
    ];
    renderTrace(
      "span=root&start=2026-10-17%2012:00:00.000&end=2026-10-17%2012:00:20.000",
    );
    expect(
      await screen.findByRole("button", { name: "Select root" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Replay" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("no clip at this moment"),
    ).not.toBeInTheDocument();
    expect(calls.some((call) => call.sql.includes("FROM recordings"))).toBe(
      false,
    );
    expect(
      calls.some((call) => call.sql.includes("SpanName = 'recording'")),
    ).toBe(false);
  });

  it("says there is no clip at this moment and links the session clips", async () => {
    db.spans = [
      rawSpan({
        spanId: "root",
        serviceName: "api",
        timestampMs: ROOT_MS,
        durationMs: 20_000,
      }),
      browserEntry,
    ];
    db.sessionClips = [
      recordingRow({
        clipId: "clip-later",
        traceId: "trace-clip",
        startMs: ROOT_MS + 30_000,
        durationMs: 5_000,
      }),
    ];
    renderTrace();
    expect(
      await screen.findByText("no clip at this moment"),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "clip-later" });
    expect(link).toHaveAttribute("href", expect.stringContaining("trace-clip"));
    const listed = calls.filter(
      (call) =>
        call.sql.includes("SpanName = 'recording'") &&
        !call.sql.includes("everr.recording.stream.id"),
    );
    expect(listed.length).toBeGreaterThan(0);
    expect(listed[0]?.sql).not.toContain("addNanoseconds");
    expect(listed[0]?.sql).not.toContain("Timestamp BETWEEN");
    expect(listed[0]?.params).toEqual({ sessionId: "sess-1" });
    expect(listed[0]?.params).not.toHaveProperty("streamId");
    expect(listed[0]?.params).not.toHaveProperty("fromTs");
    expect(listed[0]?.params).not.toHaveProperty("toTs");
    expect(
      screen
        .getByRole("region", { name: "Replay" })
        .compareDocumentPosition(
          screen.getByRole("region", { name: "Trace explorer detail" }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("plays the earliest covering clip from the entry, scoped without a tenant filter", async () => {
    db.spans = [
      rawSpan({
        spanId: "root",
        serviceName: "api",
        timestampMs: ROOT_MS,
        durationMs: 20_000,
      }),
      browserEntry,
      rawSpan({
        spanId: "pay",
        parentSpanId: "root",
        serviceName: "shop-web",
        timestampMs: PAY_MS,
        durationMs: 1_000,
      }),
    ];
    db.covering = [
      recordingRow({
        clipId: "clip-late",
        traceId: "trace-late",
        startMs: ROOT_MS + 2_000,
        durationMs: 20_000,
      }),
      recordingRow({
        clipId: "clip-early",
        traceId: "trace-early",
        startMs: ROOT_MS,
        durationMs: 20_000,
      }),
    ];
    db.segments = [
      {
        segmentIndex: "1",
        body: JSON.stringify([
          { type: 3, timestamp: PAY_MS, data: { source: 1 } },
        ]),
      },
      {
        segmentIndex: "0",
        body: JSON.stringify([
          {
            type: 2,
            timestamp: FIRST_EVENT_MS,
            data: { href: "https://shop.example", width: 800, height: 600 },
          },
        ]),
      },
    ];
    const router = renderTrace();
    expect(await screen.findByText("6.0s")).toBeInTheDocument();
    await waitFor(() => expect(replays.length).toBeGreaterThan(0));
    const player = replays[0];
    expect(player?.pauses).toContain(6_000);
    expect(player?.events).toEqual([
      {
        type: 2,
        timestamp: FIRST_EVENT_MS,
        data: { href: "https://shop.example", width: 800, height: 600 },
      },
      { type: 3, timestamp: PAY_MS, data: { source: 1 } },
    ]);
    const choice = calls.filter((call) =>
      call.sql.includes("everr.recording.stream.id"),
    );
    expect(choice.length).toBeGreaterThan(0);
    expect(choice[0]?.sql).toContain("SpanName = 'recording'");
    expect(choice[0]?.sql).toContain("session.id");
    expect(choice[0]?.sql).toContain("addNanoseconds");
    expect(choice[0]?.params).toMatchObject({
      sessionId: "sess-1",
      streamId: "stream-1",
      entryTs: "2026-10-17 12:00:05.000",
    });
    const segments = calls.filter((call) =>
      call.sql.includes("FROM recordings"),
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]?.sql).toContain("ServiceName = {service:String}");
    expect(segments[0]?.sql).toContain("session_id = {sessionId:String}");
    expect(segments[0]?.sql).toContain("clip_id = {clipId:String}");
    expect(segments[0]?.sql).toContain("Timestamp BETWEEN");
    expect(segments[0]?.sql).not.toContain("tenant_id");
    expect(segments[0]?.sql).not.toContain("SQL_everr_tenant_id");
    expect(segments[0]?.params).toEqual({
      service: "shop-web",
      fromTs: "2026-10-17 11:59:00.000",
      toTs: "2026-10-17 12:00:20.000",
      sessionId: "sess-1",
      clipId: "clip-early",
    });
    const replay = screen.getByRole("region", { name: "Replay" });
    const detail = screen.getByRole("region", {
      name: "Trace explorer detail",
    });
    expect(
      replay.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Select pay" }));
    await waitFor(() => expect(player?.pauses).toContain(9_000));
    expect(router.state.location.search).toMatchObject({ span: "pay" });

    holdFrames = true;
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    const playing = replays[0];
    if (playing) playing.time = 9_000;
    await act(async () => {
      frames.shift()?.(0);
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Select pay" }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
    expect(router.state.location.search).toMatchObject({ span: "pay" });
  });

  it("opens the browser session's clip for a backend entry", async () => {
    db.spans = [
      rawSpan({
        spanId: "root",
        serviceName: "api",
        spanKind: "Server",
        timestampMs: ROOT_MS,
        durationMs: 20_000,
      }),
      rawSpan({
        spanId: "call",
        parentSpanId: "root",
        serviceName: "shop-web",
        spanKind: "Client",
        timestampMs: ROOT_MS - 500,
        durationMs: 20_500,
        attributes: {
          "session.id": "sess-1",
          "everr.recording.stream.id": "stream-1",
        },
      }),
    ];
    db.covering = [
      recordingRow({
        clipId: "clip-1",
        traceId: "trace-clip",
        startMs: ROOT_MS - 2_000,
        durationMs: 20_000,
      }),
    ];
    db.segments = [
      {
        segmentIndex: "0",
        body: JSON.stringify([
          {
            type: 2,
            timestamp: FIRST_EVENT_MS,
            data: { href: "https://shop.example", width: 800, height: 600 },
          },
        ]),
      },
    ];
    renderTrace(
      "span=root&start=2026-10-17%2012:00:00.000&end=2026-10-17%2012:00:20.000",
    );

    expect(await screen.findByText("1.0s")).toBeInTheDocument();
    await waitFor(() => expect(replays.length).toBeGreaterThan(0));
    const choice = calls.filter((call) =>
      call.sql.includes("everr.recording.stream.id"),
    );
    expect(choice[0]?.params).toMatchObject({
      sessionId: "sess-1",
      streamId: "stream-1",
      entryTs: "2026-10-17 12:00:00.000",
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

  it("has no session when the trace's client spans disagree", async () => {
    db.spans = [
      rawSpan({
        spanId: "root",
        serviceName: "api",
        spanKind: "Server",
        timestampMs: ROOT_MS,
        durationMs: 20_000,
      }),
      rawSpan({
        spanId: "call-a",
        parentSpanId: "root",
        serviceName: "shop-web",
        timestampMs: ROOT_MS - 500,
        durationMs: 2_000,
        attributes: {
          "session.id": "sess-a",
          "everr.recording.stream.id": "stream-1",
        },
      }),
      rawSpan({
        spanId: "call-b",
        parentSpanId: "root",
        serviceName: "shop-web",
        timestampMs: ROOT_MS + 1_000,
        durationMs: 2_000,
        attributes: {
          "session.id": "sess-b",
          "everr.recording.stream.id": "stream-1",
        },
      }),
    ];
    renderTrace(
      "span=root&start=2026-10-17%2012:00:00.000&end=2026-10-17%2012:00:20.000",
    );

    expect(
      await screen.findByRole("button", { name: "Select root" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Replay" }),
    ).not.toBeInTheDocument();
    expect(
      calls.some((call) => call.sql.includes("SpanName = 'recording'")),
    ).toBe(false);
  });

  it("shows no clip when the trace's client spans disagree on the stream", async () => {
    db.spans = [
      rawSpan({
        spanId: "root",
        serviceName: "api",
        spanKind: "Server",
        timestampMs: ROOT_MS,
        durationMs: 20_000,
      }),
      rawSpan({
        spanId: "call-a",
        parentSpanId: "root",
        serviceName: "shop-web",
        timestampMs: ROOT_MS - 500,
        durationMs: 2_000,
        attributes: {
          "session.id": "sess-1",
          "everr.recording.stream.id": "stream-a",
        },
      }),
      rawSpan({
        spanId: "call-b",
        parentSpanId: "root",
        serviceName: "shop-web",
        timestampMs: ROOT_MS + 1_000,
        durationMs: 2_000,
        attributes: {
          "session.id": "sess-1",
          "everr.recording.stream.id": "stream-b",
        },
      }),
    ];
    db.sessionClips = [
      recordingRow({
        clipId: "clip-other",
        traceId: "trace-clip",
        startMs: ROOT_MS + 30_000,
        durationMs: 5_000,
      }),
    ];
    renderTrace(
      "span=root&start=2026-10-17%2012:00:00.000&end=2026-10-17%2012:00:20.000",
    );

    expect(
      await screen.findByText("no clip at this moment"),
    ).toBeInTheDocument();
    const listed = calls.filter(
      (call) =>
        call.sql.includes("SpanName = 'recording'") &&
        !call.sql.includes("everr.recording.stream.id"),
    );
    expect(listed[0]?.params).toMatchObject({ sessionId: "sess-1" });
    expect(listed[0]?.params).not.toHaveProperty("streamId");
    expect(
      calls.some(
        (call) =>
          call.sql.includes("SpanName = 'recording'") &&
          call.sql.includes("everr.recording.stream.id"),
      ),
    ).toBe(false);
  });

  it("draws logs and error logs on their span rows and leaves spanless logs off", async () => {
    db.spans = [
      rawSpan({
        spanId: "root",
        serviceName: "api",
        spanKind: "Server",
        timestampMs: ROOT_MS,
        durationMs: 20_000,
      }),
      browserEntry,
    ];
    db.logs = [
      rawLog({
        spanId: "click",
        timestampMs: ENTRY_MS,
        severityNumber: 17,
        severityText: "ERROR",
        body: "PaymentError: card declined",
        eventName: "exception",
        exceptionType: "PaymentError",
        exceptionMessage: "card declined",
      }),
      rawLog({
        spanId: "",
        timestampMs: ENTRY_MS + 1,
        body: "spanless log",
      }),
      rawLog({
        spanId: "root",
        timestampMs: ROOT_MS + 2_000,
        body: "root log",
      }),
    ];
    renderTrace();

    expect(
      await screen.findByRole("button", { name: "Select root" }),
    ).toBeInTheDocument();
    const errorLog = await screen.findByTitle(
      "ERROR: PaymentError: card declined",
    );
    expect(errorLog).toHaveAttribute("aria-label", "Error log");
    expect(errorLog.closest("[data-span-id]")).toHaveAttribute(
      "data-span-id",
      "click",
    );
    const infoLog = screen.getByTitle("INFO: root log");
    expect(infoLog).toHaveAttribute("aria-label", "Log");
    expect(infoLog.closest("[data-span-id]")).toHaveAttribute(
      "data-span-id",
      "root",
    );
    expect(screen.queryByTitle(/spanless log/)).not.toBeInTheDocument();
    const reads = calls.filter(
      (call) =>
        call.sql.includes("FROM logs") &&
        call.sql.includes("traces_trace_id_ts"),
    );
    expect(reads).toHaveLength(1);
    expect(reads[0]?.params).toEqual({ traceId: "trace-1" });
    expect(reads[0]?.sql).toContain("SeverityNumber AS severityNumber");
    expect(reads[0]?.sql).toContain("SeverityText AS severityText");
    expect(reads[0]?.sql).toContain("Body AS body");
    expect(reads[0]?.sql).toContain("EventName AS eventName");
    expect(reads[0]?.sql).toContain("exception.type");
    expect(reads[0]?.sql).toContain("exception.message");
    expect(reads[0]?.sql).toContain("SpanId != ''");
  });

  it("marks truncation, the automatic Clip trigger and tail, and replay gaps", async () => {
    db.spans = [
      rawSpan({
        spanId: "root",
        serviceName: "api",
        spanKind: "Server",
        timestampMs: ROOT_MS,
        durationMs: 20_000,
      }),
      browserEntry,
    ];
    db.covering = [
      recordingRow({
        clipId: "clip-1",
        traceId: "trace-clip",
        startMs: ROOT_MS - 60_000,
        durationMs: 112_000,
        trigger: "error",
        truncated: true,
      }),
    ];
    db.segments = [
      {
        segmentIndex: "0",
        body: JSON.stringify([
          { type: 2, timestamp: FIRST_EVENT_MS, data: {} },
          {
            type: 5,
            timestamp: FIRST_EVENT_MS + 10_000,
            data: { tag: "everr.recording.pause" },
          },
          {
            type: 5,
            timestamp: FIRST_EVENT_MS + 15_000,
            data: { tag: "everr.recording.resume" },
          },
        ]),
      },
      {
        segmentIndex: "2",
        body: JSON.stringify([
          { type: 3, timestamp: FIRST_EVENT_MS + 20_000, data: { source: 1 } },
          { type: 3, timestamp: FIRST_EVENT_MS + 50_000, data: { source: 2 } },
        ]),
      },
    ];
    renderTrace();

    expect(await screen.findByText("truncated")).toBeInTheDocument();
    expect(screen.getByText(/error trigger/)).toBeInTheDocument();
    expect(screen.getByText(/from 11:59:00\.000/)).toBeInTheDocument();
    expect(screen.getByText("1 missing segment")).toBeInTheDocument();
    expect(screen.getByText("1 paused range")).toBeInTheDocument();
    expect(screen.getByLabelText("paused")).toBeInTheDocument();
    expect(screen.getByLabelText("tail")).toBeInTheDocument();
    expect(screen.getByLabelText("trigger")).toBeInTheDocument();
    await waitFor(() => expect(replays.length).toBeGreaterThan(0));
  });

  it("does not infer a pause from a silent stretch", async () => {
    db.spans = [
      rawSpan({
        spanId: "root",
        serviceName: "api",
        spanKind: "Server",
        timestampMs: ROOT_MS,
        durationMs: 20_000,
      }),
      browserEntry,
    ];
    db.covering = [
      recordingRow({
        clipId: "clip-1",
        traceId: "trace-clip",
        startMs: FIRST_EVENT_MS - 2_000,
        durationMs: 34_000,
      }),
    ];
    db.segments = [
      {
        segmentIndex: "0",
        body: JSON.stringify([
          { type: 2, timestamp: FIRST_EVENT_MS, data: {} },
          { type: 3, timestamp: FIRST_EVENT_MS + 30_000, data: { source: 1 } },
        ]),
      },
    ];
    renderTrace();

    expect(
      await screen.findByRole("region", { name: "Replay" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/paused range/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("paused")).not.toBeInTheDocument();
  });

  it("shows a lost index 0 as a missing segment", async () => {
    db.spans = [
      rawSpan({
        spanId: "root",
        serviceName: "api",
        spanKind: "Server",
        timestampMs: ROOT_MS,
        durationMs: 20_000,
      }),
      browserEntry,
    ];
    db.covering = [
      recordingRow({
        clipId: "clip-1",
        traceId: "trace-clip",
        startMs: FIRST_EVENT_MS - 2_000,
        durationMs: 4_000,
      }),
    ];
    db.segments = [
      {
        segmentIndex: "1",
        body: JSON.stringify([
          { type: 2, timestamp: FIRST_EVENT_MS, data: {} },
        ]),
      },
    ];
    renderTrace();

    expect(await screen.findByText("1 missing segment")).toBeInTheDocument();
  });

  it("shows a tail gap when the recording span outlasts the events", async () => {
    db.spans = [
      rawSpan({
        spanId: "root",
        serviceName: "api",
        spanKind: "Server",
        timestampMs: ROOT_MS,
        durationMs: 20_000,
      }),
      browserEntry,
    ];
    db.covering = [
      recordingRow({
        clipId: "clip-1",
        traceId: "trace-clip",
        startMs: FIRST_EVENT_MS - 2_000,
        durationMs: 30_000,
      }),
    ];
    db.segments = [
      {
        segmentIndex: "0",
        body: JSON.stringify([
          { type: 2, timestamp: FIRST_EVENT_MS, data: {} },
          { type: 3, timestamp: FIRST_EVENT_MS + 5_000, data: { source: 1 } },
        ]),
      },
    ];
    renderTrace();

    expect(await screen.findByText("1 missing segment")).toBeInTheDocument();
    expect(screen.getByLabelText("missing segment")).toBeInTheDocument();
  });
});
