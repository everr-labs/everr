import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("#app/lib/clickhouse.ts", () => ({
  query: vi.fn(),
  queryLines: vi.fn(),
  querySqlApi: vi.fn(),
  runSqlApiQuery: vi.fn(),
}));

import {
  type ClipWindow,
  clipEvents,
  loadClips,
  ReplayError,
  replayHttpError,
  segmentLines,
  select,
  windowAround,
} from "./session.ts";
import {
  CLIP_ID,
  calls,
  collect,
  HOUR,
  isClipQuery,
  isSegmentQuery,
  ORG,
  plan,
  STREAM,
  segLine,
  segRow,
  spanRow,
} from "./test-fixtures.ts";

const T0 = Date.UTC(2026, 10, 14, 10, 20, 0);
const DAY = 24 * HOUR;
const WINDOW = windowAround(T0);

function clip(overrides: Partial<ClipWindow> = {}): ClipWindow {
  return {
    clipId: CLIP_ID,
    streamId: STREAM,
    serviceName: "verify-sdk-web",
    start: new Date(T0),
    end: new Date(T0 + 5_000),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  plan();
});

describe("loadClips", () => {
  it("reads the Clips of the Stream overlapping 5 minutes either side of --at, starts 24 hours back", async () => {
    expect(WINDOW).toEqual({ from: new Date(T0 - 5 * 60_000), to: new Date(T0 + 5 * 60_000) });
    await loadClips(ORG, STREAM, WINDOW);
    const [call] = calls(isClipQuery);
    expect(call?.sql).toContain(
      "toString(SpanAttributes.`everr.recording.stream.id`) = {stream:String}",
    );
    expect(call?.params).toMatchObject({
      stream: STREAM,
      startFromMs: WINDOW.from.getTime() - DAY,
      fromMs: WINDOW.from.getTime(),
      toMs: WINDOW.to.getTime(),
    });
    // Overlap: started before the window's end, ended after its start.
    expect(call?.sql).toMatch(
      /Timestamp \+ toIntervalNanosecond\(Duration\) >= fromUnixTimestamp64Milli\(\{fromMs/,
    );
    expect(call?.settings).toEqual({ date_time_input_format: "best_effort" });
  });

  it("finds a Clip that started at an old Generation and still covers the window", async () => {
    plan({ clips: [spanRow({ startMs: T0 - 3 * HOUR, endMs: T0 + 1_000 })] });
    const clips = await loadClips(ORG, STREAM, WINDOW);
    expect(clips.map((c) => c.start.getTime())).toEqual([T0 - 3 * HOUR]);
  });

  it("skips a span without a Clip id or a service, and counts a Clip stored twice once", async () => {
    plan({
      clips: [
        spanRow({ startMs: T0, clipId: "" }),
        spanRow({ startMs: T0, clipId: "c2", serviceName: "" }),
        spanRow({ startMs: T0 }),
        spanRow({ startMs: T0 }),
      ],
    });
    expect(await loadClips(ORG, STREAM, WINDOW)).toEqual([
      clip({ start: new Date(T0), end: new Date(T0 + 5_000) }),
    ]);
  });

  it("reads at most 20 Clips", async () => {
    plan({
      clips: Array.from({ length: 21 }, (_, i) =>
        spanRow({ startMs: T0, clipId: i.toString(16).padStart(32, "0") }),
      ),
    });
    expect(await loadClips(ORG, STREAM, WINDOW)).toHaveLength(20);
  });
});

describe("select", () => {
  const at = (ms: number) => T0 + ms;
  const span = (clipId: string, from: number, to: number) =>
    clip({ clipId, start: new Date(at(from)), end: new Date(at(to)) });
  const clips = [
    span("c1000000", 0, 60_000),
    span("c2000000", 120_000, 180_000),
    span("c3000000", 400_000, 460_000),
  ];

  it("picks the Clip covering --at that ends last", () => {
    const overlapping = [span("c1000000", 0, 60_000), span("c4000000", 30_000, 90_000)];
    expect(select(overlapping, STREAM, at(45_000), windowAround(at(45_000))).clipId).toBe(
      "c4000000",
    );
    expect(select(clips, STREAM, at(30_000), windowAround(at(30_000))).clipId).toBe("c1000000");
  });

  it("names the nearest Clips when none covers --at", () => {
    const failure = (() => {
      try {
        return select(clips, STREAM, at(90_000), windowAround(at(90_000)));
      } catch (e) {
        return e;
      }
    })();
    expect(failure).toMatchObject({ code: "outside_clip" });
    const message = (failure as Error).message;
    expect(message).toContain(
      `No Clip covers ${new Date(at(90_000)).toISOString()} in stream ${STREAM}`,
    );
    // Nearest first, at most three, each with its range and distance.
    expect(message.match(/clip c\d000000/g)).toEqual([
      "clip c1000000",
      "clip c2000000",
      "clip c3000000",
    ]);
    expect(message).toContain("(ends 30s before that instant)");
    expect(message).toContain("Pass an --at inside a Clip.");
  });

  it("is not_found when no Clip overlaps the window, and points at the recording spans", () => {
    expect(() => select([], STREAM, T0, WINDOW)).toThrow(
      expect.objectContaining({
        code: "not_found",
        message: `No Clip of stream ${STREAM} overlaps ${WINDOW.from.toISOString()}..${WINDOW.to.toISOString()} (5 minutes either side of --at). Find Clips in the \`recording\` spans of \`traces\`.`,
      }),
    );
  });
});

describe("segmentLines", () => {
  const rowReads = () => calls((sql) => isSegmentQuery(sql) && !sql.includes("AS bytes"));

  it("reads the Segments of the Clip's Stream from its start up to `at`, as JSON lines", async () => {
    const rows = [segRow("[1]"), segRow("[2]", { segment_index: 1 })];
    plan({ recordings: [...rows, segRow("[3]", { stream_id: "another" })] });
    const lines = await segmentLines(ORG, clip(), new Date(T0 + 1_000));
    expect(await collect(lines)).toEqual(rows.map(segLine));
    expect(rowReads().map((c) => c.params)).toEqual([
      { service: "verify-sdk-web", stream: STREAM, fromMs: T0, toMs: T0 + 1_000 },
    ]);
    expect(rowReads()[0]?.sql).toContain("ORDER BY segment_index");
  });

  it("refuses a read over 32 MiB of Segments before reading a row", async () => {
    plan({ recordings: [segRow("[]")], bytes: 33 * 1024 * 1024 });
    const failure = await segmentLines(ORG, clip(), new Date(T0 + 1_000)).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ReplayError);
    expect(failure).toMatchObject({ code: "too_large" });
    expect(replayHttpError(failure).status).toBe(413);
    expect(rowReads()).toEqual([]);
  });
});

describe("replayHttpError", () => {
  it.each([
    ["bad_request", 400],
    ["outside_clip", 404],
    ["not_found", 404],
    ["too_large", 413],
  ] as const)("maps %s to %i with { error, message }", async (code, status) => {
    const response = replayHttpError(new ReplayError(code, "why"));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code, message: "why" });
  });

  it("hides anything else behind a 500", async () => {
    const response = replayHttpError(new Error("secret detail"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal" });
  });
});

describe("clipEvents", () => {
  const event = (type: number, timestamp: number, data: Record<string, unknown> = {}) => ({
    type,
    timestamp,
    data,
  });
  const body = (events: unknown[]) => JSON.stringify(events);

  it("joins a snapshot sent in pieces, sorts by time, ends at the Clip's end, and reports gaps", async () => {
    const snapshot = JSON.stringify(
      event(2, T0 + 100, { node: { type: 0, id: 1, childNodes: [] } }),
    );
    const half = Math.floor(snapshot.length / 2);
    plan({
      clips: [
        spanRow({ startMs: T0, endMs: T0 + 5_000 }),
        spanRow({ startMs: T0, endMs: T0 + 5_000 }),
      ],
      recordings: [
        segRow(body([event(4, T0 + 50, { href: "/" })]), { segment_index: 0 }),
        segRow(snapshot.slice(0, half), {
          segment_index: 1,
          event_index: "7",
          piece: "0",
          pieces: "2",
        }),
        segRow(snapshot.slice(half), {
          segment_index: 2,
          event_index: "7",
          piece: "1",
          pieces: "2",
        }),
        segRow(body([event(3, T0 + 4_000), event(3, T0 + 3_000)]), { segment_index: 4 }),
        segRow(body([event(3, T0 + 5_001)]), { segment_index: 5 }),
      ],
    });

    const { events, gaps } = await clipEvents(ORG, CLIP_ID, T0);

    expect(events.map((e) => [e.type, e.timestamp])).toEqual([
      [4, T0 + 50],
      [2, T0 + 100],
      [3, T0 + 3_000],
      [3, T0 + 4_000],
    ]);
    expect(gaps).toEqual([{ kind: "index", streamId: STREAM, after: 2, missing: 1 }]);
    expect(calls(isClipQuery)[0]?.params).toMatchObject({ clipId: CLIP_ID });
    expect(calls(isSegmentQuery)[0]?.params).toMatchObject({
      stream: STREAM,
      fromMs: T0,
      toMs: T0 + 5_000,
    });
  });

  it("answers 404 for a clip id with no recording span near its start", async () => {
    plan({ clips: [], recordings: [] });
    const failure = await clipEvents(ORG, CLIP_ID, T0).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "outside_clip" });
    expect(replayHttpError(failure).status).toBe(404);
  });
});
