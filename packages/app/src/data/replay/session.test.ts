import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("#app/lib/clickhouse.ts", () => ({
  query: vi.fn(),
  querySqlApi: vi.fn(),
  runSqlApiQuery: vi.fn(),
}));

import { query } from "#app/lib/clickhouse.ts";
import { pageAt, replayHttpError, sessionJourney, type SessionJourney } from "./session.ts";

const mockedQuery = vi.mocked(query);

const CLIP_ID = "8fa44e8b05e90c9b9204397b6efeb32f";
const STREAM = "dbe6963e8f8a0df621eeb891846e5d30";
const SESSION = "sess-1";
const SERVICE = "verify-sdk-web";
const ORG = "org-1";
const HOUR = 60 * 60 * 1000;
const WINDOW_MAX_MS = 24 * HOUR;
const T0 = Date.now() - 10_000;

type SpanRow = {
  serviceName: string;
  startMs: number;
  endMs: number;
  clipId: string;
  streamId: string;
  trigger: string;
  truncated: string;
  sessionId: string;
};

type SegmentRow = {
  stream_id: string;
  segment_index: number;
  Body: string;
  event_index: string;
  piece: string;
  pieces: string;
};

function spanRow(overrides: Partial<SpanRow> = {}): SpanRow {
  return {
    serviceName: SERVICE,
    startMs: T0,
    endMs: T0 + 5_000,
    clipId: CLIP_ID,
    streamId: STREAM,
    trigger: "error",
    truncated: "false",
    sessionId: SESSION,
    ...overrides,
  };
}

function rrwebEvent(event: Record<string, unknown>, atMs: number): Record<string, unknown> {
  return { ...event, timestamp: atMs };
}

function metaEvent(
  atMs: number,
  url = "http://127.0.0.1:49158/index.html",
): Record<string, unknown> {
  return rrwebEvent({ type: 4, data: { href: url, width: 1280, height: 800 } }, atMs);
}

function clickEvent(atMs: number): Record<string, unknown> {
  // source 2 (mouse interaction); mouseType 2 and 4 project as clicks
  return rrwebEvent({ type: 3, data: { source: 2, type: 4, id: 22 } }, atMs);
}

function pageSnapshot(): Record<string, unknown> {
  return {
    type: 0,
    childNodes: [
      {
        type: 2,
        tagName: "html",
        attributes: {},
        id: 3,
        childNodes: [
          {
            type: 2,
            tagName: "style",
            attributes: {},
            id: 5,
            childNodes: [{ type: 3, id: 6, textContent: "a > b { color: red }" }],
          },
          {
            type: 2,
            tagName: "p",
            attributes: {},
            id: 7,
            childNodes: [{ type: 3, id: 8, textContent: "verify sdk item 1" }],
          },
        ],
      },
    ],
  };
}

function segRow(body: string, overrides: Partial<SegmentRow> = {}): SegmentRow {
  return {
    stream_id: STREAM,
    segment_index: 0,
    Body: body,
    event_index: "",
    piece: "",
    pieces: "",
    ...overrides,
  };
}

function eventBody(events: Array<Record<string, unknown>>): string {
  return JSON.stringify(events);
}

function plan(rows?: { traces?: Array<unknown>; recordings?: Array<unknown> }): void {
  mockedQuery.mockImplementation(async (sql: string) => {
    if (/FROM\s+traces/.test(sql)) return (rows?.traces ?? []) as never;
    if (/FROM\s+recordings/.test(sql)) return (rows?.recordings ?? []) as never;
    throw new Error(`unexpected query: ${sql}`);
  });
}

interface QueryCall {
  sql: string;
  params: Record<string, unknown>;
  settings?: Record<string, string>;
}

function callsFor(table: "traces" | "recordings"): QueryCall[] {
  return mockedQuery.mock.calls
    .filter(([sql]) => sql.includes(`FROM ${table}`))
    .map(([sql, _org, params, settings]) => ({
      sql,
      params: (params ?? {}) as Record<string, unknown>,
      settings: settings as unknown as QueryCall["settings"],
    }));
}

beforeEach(() => {
  vi.clearAllMocks();
  plan();
});

describe("sessionJourney", () => {
  it("projects steps and facts from numeric clip windows and segment events", async () => {
    plan({
      traces: [spanRow()],
      recordings: [
        segRow(
          eventBody([
            metaEvent(T0 + 10),
            { type: 2, timestamp: T0 + 200, data: { node: pageSnapshot() } },
            clickEvent(T0 + 300),
            clickEvent(T0 + 400),
          ]),
        ),
      ],
    });

    const journey = await sessionJourney(ORG, SESSION);

    expect(journey.clips).toHaveLength(1);
    expect(journey.clips[0]).toMatchObject({ trigger: "error", clipId: CLIP_ID });
    expect(journey.facts.pages).toBe(1);
    expect(journey.facts.clicks).toBe(2);
    expect(journey.facts.clipsByTrigger.error).toBe(1);
    expect(journey.steps[0]).toMatchObject({
      kind: "page",
      url: "http://127.0.0.1:49158/index.html",
    });

    // The clip window crosses the boundary as epoch numbers, parsed from the
    // row side with a tz-independent expression; queries run with best_effort
    // so string parameters (ISO-8601 UTC) stay true to the instant they name.
    const trace = callsFor("traces")[0];
    expect(trace.sql).toContain("fromUnixTimestamp64Milli");
    expect(trace.sql).toContain("toUnixTimestamp64Milli");
    expect(trace.settings).toEqual({ date_time_input_format: "best_effort" });
    expect(trace.params).toMatchObject({
      sessionId: SESSION,
      fromMs: expect.any(Number),
      toMs: expect.any(Number),
      cap: expect.any(Number),
    });
  });

  it("caps the implicit window at 24 hours: no window and to-only both work", async () => {
    plan({ traces: [spanRow()], recordings: [] });

    const toOnly = await sessionJourney(ORG, SESSION, { to: new Date(T0 + HOUR) });
    expect(toOnly.windowEnd).toBe(new Date(T0 + HOUR).toISOString());
    const toCall = callsFor("traces").at(-1);
    expect(toCall).toBeDefined();
    expect(toOnly.windowStart).toMatch(/^2026-11-0[45]/);
    expect((toCall?.params.toMs as number) - (toCall?.params.fromMs as number)).toBe(WINDOW_MAX_MS);
  });

  it("caps the no-window call at 24 hours too", async () => {
    plan({ traces: [], recordings: [] });

    await sessionJourney(ORG, SESSION);
    const call = callsFor("traces")[0];
    expect((call.params.toMs as number) - (call.params.fromMs as number)).toBe(WINDOW_MAX_MS);
  });

  it("returns an empty journey when nothing exists in the window", async () => {
    plan({ traces: [], recordings: [] });

    const journey: SessionJourney = await sessionJourney(ORG, SESSION, {
      from: new Date(T0 - HOUR),
      to: new Date(T0 + HOUR),
    });

    expect(journey.windowStart).toBe(new Date(T0 - HOUR).toISOString());
    expect(journey.windowEnd).toBe(new Date(T0 + HOUR).toISOString());
    expect(journey.steps).toHaveLength(0);
    expect(journey.facts.gapCount).toBe(0);
    expect(journey.facts.clipsByTrigger).toEqual({ error: 0, network: 0, manual: 0 });
  });

  it("rejects a window wider than 24 hours and from after to", async () => {
    plan({ traces: [], recordings: [] });

    await expect(
      sessionJourney(ORG, SESSION, {
        from: new Date(T0),
        to: new Date(T0 + WINDOW_MAX_MS + 1),
      }),
    ).rejects.toMatchObject({ code: "bad_request" });

    await expect(
      sessionJourney(ORG, SESSION, { from: new Date(T0), to: new Date(T0 - 60 * 1000) }),
    ).rejects.toMatchObject({ code: "bad_request" });
  });

  it("skips spans with a missing id or an unknown trigger as clip gaps", async () => {
    plan({
      traces: [spanRow({ clipId: "" }), spanRow({ trigger: "everr.automatic" }), spanRow()],
      recordings: [segRow(eventBody([metaEvent(T0 + 10)]))],
    });
    const journey = await sessionJourney(ORG, SESSION);

    expect(journey.clips).toHaveLength(1);
    expect(journey.gaps).toHaveLength(2);
    expect(journey.gaps.every((g) => g.kind === "clip")).toBe(true);
    expect(journey.facts.gapCount).toBe(2);
  });

  it("caps steps globally across streams at 500", async () => {
    plan({
      traces: [spanRow({ streamId: "stream-a" }), spanRow({ streamId: "stream-b" })],
      recordings: [
        segRow(eventBody(Array.from({ length: 510 }, (_, i) => clickEvent(T0 + i * 2))), {
          stream_id: "stream-a",
        }),
        segRow(eventBody(Array.from({ length: 510 }, (_, i) => clickEvent(T0 + i * 2 + 1))), {
          stream_id: "stream-b",
        }),
      ],
    });

    const journey = await sessionJourney(ORG, SESSION);

    expect(journey.truncated).toBe(true);
    expect(journey.steps).toHaveLength(500);
    const streams = new Set(journey.steps.map((s) => s.streamId));
    expect(streams.has("stream-a")).toBe(true);
    expect(streams.has("stream-b")).toBe(true);
    // The earliest step comes first: the interleaved streams share the cap,
    // rather than one stream spending it all before the other appears.
    expect(journey.steps[0].at).toBe(new Date(T0).toISOString());
    expect(journey.facts.clicks).toBe(500);
  });

  it("records index, piece, and conflict gaps", async () => {
    plan({
      traces: [spanRow()],
      recordings: [
        // The reader matches segments against the clip's stream id; a missing
        // segment index shows up as an index gap, duplicated bodies as a
        // conflict, and an unparsable body as a piece gap.
        segRow(eventBody([metaEvent(T0 + 10)]), { segment_index: 0 }),
        segRow("not an array", { segment_index: 2 }),
        segRow(eventBody([metaEvent(T0 + 20)]), { segment_index: 2 }),
      ],
    });
    const journey = await sessionJourney(ORG, SESSION);

    expect(journey.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "index", missing: 1, after: 0 }),
        expect.objectContaining({ kind: "conflict", segmentIndex: 2 }),
        expect.objectContaining({ kind: "piece" }),
      ]),
    );
  });
});

describe("pageAt", () => {
  it("builds the page from deduplicated at-least-once clip rows", async () => {
    plan({
      traces: [spanRow(), spanRow()],
      recordings: [
        segRow(
          eventBody([
            metaEvent(T0 + 10),
            { type: 2, timestamp: T0 + 200, data: { node: pageSnapshot() } },
          ]),
        ),
      ],
    });
    const page = await pageAt(ORG, {
      clipId: CLIP_ID,
      at: new Date(T0 + 1_000).toISOString(),
    });

    expect(page).toMatchObject({ clipId: CLIP_ID, sessionId: SESSION, coverage: "complete" });
    expect(page.html).toContain("verify sdk item 1");
  });

  it("refuses a clip from another session", async () => {
    plan({
      traces: [spanRow({ sessionId: "sess-2" })],
      recordings: [],
    });
    await expect(
      pageAt(ORG, { sessionId: SESSION, clipId: CLIP_ID, at: new Date(T0 + 1_000).toISOString() }),
    ).rejects.toMatchObject({ code: "outside_clip", message: "clip belongs to another session" });
  });

  it("keeps <style> text raw while markup text stays escaped", async () => {
    plan({
      traces: [spanRow()],
      recordings: [
        segRow(
          eventBody([
            metaEvent(T0 + 10),
            { type: 2, timestamp: T0 + 200, data: { node: pageSnapshot() } },
          ]),
        ),
      ],
    });
    const page = await pageAt(ORG, {
      clipId: CLIP_ID,
      at: new Date(T0 + 1_000).toISOString(),
    });

    expect(page.html).toContain("a > b { color: red }");
    expect(page.html).not.toContain("a &gt; b");
  });

  it("rejects an at outside the clip span with 404", async () => {
    plan({
      traces: [spanRow()],
      recordings: [],
    });
    const failure = await pageAt(ORG, {
      sessionId: SESSION,
      at: new Date(T0 - HOUR).toISOString(),
    }).catch((error: unknown) => error);
    expect(replayHttpError(failure).status).toBe(404);
  });
});
