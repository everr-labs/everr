import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("#app/lib/clickhouse.ts", () => ({
  query: vi.fn(),
  queryLines: vi.fn(),
  querySqlApi: vi.fn(),
  runSqlApiQuery: vi.fn(),
}));

import { parseSegmentsRequest, ReplayError, readSegments, segmentsBody } from "./index.ts";
import {
  calls,
  collect,
  isClipQuery,
  isSegmentQuery,
  ORG,
  plan,
  segLine,
  segRow,
  clipRow,
} from "./test-fixtures.ts";

const T = Date.UTC(2026, 10, 14, 10, 20, 41, 120);
const STREAM = "9c41e2f0a1b34d7e8f6a5b4c3d2e1f00";
const CLIP = "8fa44e8b05e90c9b9204397b6efeb32f";

// A Clip of 70 seconds from T, with two Segments.
const SEGMENTS = [
  segRow("[1]", { stream_id: STREAM }),
  segRow("[2]", { stream_id: STREAM, segment_index: 1 }),
];
const CLIP_ROW = clipRow({
  clipId: CLIP,
  streamId: STREAM,
  serviceName: "checkout-web",
  startMs: T,
  endMs: T + 70_000,
});

const read = (params: string) =>
  readSegments(ORG, parseSegmentsRequest(new URLSearchParams(params)));
const isRowRead = (sql: string) => isSegmentQuery(sql) && !sql.includes("AS bytes");

beforeEach(() => {
  vi.clearAllMocks();
  plan();
});

describe("readSegments", () => {
  it("passes on the Segments of the covering Clip up to 0.75 s after --at, as ClickHouse wrote them", async () => {
    plan({ clips: [CLIP_ROW], recordings: SEGMENTS });
    const { readAt, lines } = await read(`stream=${STREAM}&at=2026-11-14T10:21:39.700Z`);
    expect(readAt.toISOString()).toBe("2026-11-14T10:21:40.450Z");
    expect(await collect(lines)).toEqual(SEGMENTS.map(segLine));
    expect(calls(isRowRead).map((c) => c.params)).toEqual([
      { service: "checkout-web", stream: STREAM, fromMs: T, toMs: readAt.getTime() },
    ]);
    expect(calls().filter((c) => !isClipQuery(c.sql) && !isSegmentQuery(c.sql))).toEqual([]);
  });

  it("reads no later than the Clip's end", async () => {
    plan({ clips: [CLIP_ROW], recordings: SEGMENTS });
    const { readAt } = await read(`stream=${STREAM}&at=2026-11-14T10:21:51.000Z`);
    expect(readAt.toISOString()).toBe("2026-11-14T10:21:51.120Z");
  });

  it("refuses a read over 32 MiB of Segments before reading a row", async () => {
    plan({ clips: [CLIP_ROW], recordings: SEGMENTS, bytes: 33 * 1024 * 1024 });
    await expect(read(`stream=${STREAM}&at=2026-11-14T10:21:39.700Z`)).rejects.toMatchObject({
      code: "too_large",
      message: expect.stringContaining("needs 33 MiB of Segments, over the 32 MiB"),
    });
    expect(calls(isRowRead)).toEqual([]);
  });

  it("names the nearest Clips when none covers --at", async () => {
    plan({ clips: [CLIP_ROW], recordings: SEGMENTS });
    const failure = await read(`stream=${STREAM}&at=2026-11-14T10:25:03Z`).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ReplayError);
    expect(failure).toMatchObject({ code: "outside_clip" });
    expect((failure as Error).message).toContain(
      `clip ${CLIP} 2026-11-14T10:20:41.120Z..2026-11-14T10:21:51.120Z (ends 3m12s before that instant)`,
    );
  });

  it("is not_found when the Stream has no Clip near --at", async () => {
    await expect(read(`stream=${STREAM}&at=2026-11-14T10:21:41.730Z`)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("segmentsBody", () => {
  const text = (body: ReadableStream<Uint8Array>) => new Response(body).text();
  async function* lines(...rows: string[]): AsyncGenerator<string> {
    yield* rows;
  }

  it("sends the format and the read moment, each row, then the row count", async () => {
    const body = segmentsBody({ readAt: new Date(T), lines: lines('{"a":1}', '{"b":2}') });
    expect(await text(body)).toBe(`{"format":1,"read_ms":${T}}\n{"a":1}\n{"b":2}\n{"rows":2}\n`);
  });

  it("leaves the count out when reading the rows fails, so the CLI sees the cut", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    async function* failing(): AsyncGenerator<string> {
      yield '{"a":1}';
      throw new Error("ClickHouse went away");
    }
    await expect(text(segmentsBody({ readAt: new Date(T), lines: failing() }))).rejects.toThrow();
  });
});

describe("parseSegmentsRequest", () => {
  const parse = (q: string) => () => parseSegmentsRequest(new URLSearchParams(q));
  const refused = (q: string, message: RegExp) =>
    expect(parse(q)).toThrow(
      expect.objectContaining({ code: "bad_request", message: expect.stringMatching(message) }),
    );

  it("takes --stream and --at, and names the flag otherwise", () => {
    refused("", /^Pass --stream\.$/);
    refused(`stream=${STREAM}`, /^Pass --at\.$/);
    refused("stream=&at=2026-11-14T10:21:41Z", /--stream needs a value/);
    refused(`clip=${CLIP}&at=2026-11-14T10:21:41Z`, /Unknown parameter "clip"/);
    // The CLI picks outline or HTML: the server sends the same Segments.
    refused(`stream=${STREAM}&at=2026-11-14T10:21:41Z&form=html`, /Unknown parameter "form"/);
    expect(parse(`stream=${STREAM}&at=2026-11-14T10:21:41Z`)()).toEqual({
      stream: STREAM,
      at: new Date("2026-11-14T10:21:41Z"),
    });
  });

  it("reads --at as RFC 3339 with a zone, milliseconds kept, and refuses a zoneless time", () => {
    expect(parse("stream=x&at=2026-11-14T10:21:41.730123Z")().at.toISOString()).toBe(
      "2026-11-14T10:21:41.730Z",
    );
    expect(parse("stream=x&at=2026-11-14T12:21:41.7%2B02:00")().at.toISOString()).toBe(
      "2026-11-14T10:21:41.700Z",
    );
    refused("stream=x&at=2026-11-14 10:21:41", /--at must be a time with a zone/);
    refused("stream=x&at=1794651701730", /--at must be a time with a zone/);
  });
});
