// @vitest-environment node

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session } from "chdb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

const db = vi.hoisted(() => ({ run: (_sql: string): string => "" }));

vi.mock("#app/lib/clickhouse.ts", () => ({
  query: async (sql: string, _org: string, params: Record<string, unknown> = {}) => {
    for (const [key, value] of Object.entries(params)) {
      const text = String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      db.run(`SET param_${key} = '${text}'`);
    }
    const rows = db.run(sql);
    return rows ? rows.split("\n").map((line) => JSON.parse(line)) : [];
  },
  queryLines: async (sql: string, _org: string, params: Record<string, unknown> = {}) => {
    for (const [key, value] of Object.entries(params)) {
      const text = String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      db.run(`SET param_${key} = '${text}'`);
    }
    return (async function* () {
      yield* db.run(sql).split("\n").filter(Boolean);
    })();
  },
  querySqlApi: vi.fn(),
  runSqlApiQuery: vi.fn(),
}));

import { clipEvents, loadClips, segmentLines, select, windowAround } from "./session.ts";
import { ORG } from "./test-fixtures.ts";

let session: Session;
let dataDir: string;

function run(sql: string) {
  return String(session.query(sql, "JSONEachRow") ?? "").trim();
}

function migration(file: string) {
  return readFileSync(new URL(`../../../clickhouse/${file}`, import.meta.url), "utf8");
}

// The statements of a migration: its comments and the grants on Cloud's users
// are not part of what these tests need.
function statements(sql: string) {
  return sql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "" && !statement.startsWith("GRANT"));
}

const AT = Date.UTC(2026, 10, 15, 10, 0, 0);
const SECOND = 1_000;
const HOUR = 60 * 60 * SECOND;
const civil = (ms: number) => new Date(ms).toISOString().slice(0, 23).replace("T", " ");
const streamOf = (name: string) => name.padEnd(32, "0");

type Segment = {
  stream: string;
  index: number;
  /** The Segment's Timestamp: the time of its first event. */
  at: number;
  /** `everr.recording.segment.end`. Defaults to `at`. */
  end?: number;
  /** `everr.recording.clip.start`: the start of the run. */
  start: number;
  /** The events, or the raw Body of a piece. Defaults to none: `[]`. */
  events?: unknown[];
  clipId?: string;
  trigger?: string;
};

// A Segment row as the collector stores it. The real table computes its
// materialized columns from these attributes at insert.
function segment(row: Segment) {
  const full = {
    Timestamp: civil(row.at),
    ServiceName: "web",
    Body: JSON.stringify(row.events ?? []),
    ResourceAttributes: {
      "service.name": "web",
      "everr.tenant.id": "",
      "everr.retention.days": "3650",
    },
    LogAttributes: {
      "session.id": "session-1",
      "everr.recording.stream.id": row.stream,
      "everr.recording.segment.index": String(row.index),
      "everr.recording.segment.end": String(row.end ?? row.at),
      "everr.recording.clip.start": String(row.start),
      ...(row.clipId === undefined
        ? {}
        : {
            "everr.recording.clip.id": row.clipId,
            "everr.recording.trigger": row.trigger ?? "manual",
          }),
    },
  };
  run(`INSERT INTO recordings FORMAT JSONEachRow\n${JSON.stringify(full)}`);
}

const event = (at: number) => ({ type: 3, timestamp: at, data: {} });

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "everr-recording-clips-"));
  session = new Session(dataDir);
  db.run = run;
  run("SET session_timezone = 'UTC'");
  // The real recordings table, as the migrations create it (the collector's
  // retention function comes first).
  const retention = migration("0005-create-retention-functions.sql").match(
    /CREATE OR REPLACE FUNCTION everrRetentionDaysJson[^;]*/,
  )?.[0];
  for (const statement of [
    retention ?? "",
    ...statements(migration("0013-create-recordings.sql")).map((statement) =>
      statement.replace("app.recordings", "recordings"),
    ),
  ]) {
    run(statement);
  }
});

afterAll(() => {
  session.cleanup();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("loadClips", () => {
  const WINDOW = windowAround(AT);

  // One Clip alone in its run: the Segment that opens it, then one that closes it.
  function clip(stream: string, clipId: string, start: number, end: number, first = 0) {
    segment({ stream, index: first, at: start, start, clipId });
    segment({ stream, index: first + 1, at: end, start });
  }

  it("finds the Clip that covers --at when more than 20 Clips start in the window after it", async () => {
    const stream = streamOf("many");
    clip(stream, "covering", AT - 10 * SECOND, AT + 10 * SECOND);
    for (let i = 0; i < 25; i++) {
      clip(
        stream,
        `later-${i}`,
        AT + 30 * SECOND + i * SECOND,
        AT + 31 * SECOND + i * SECOND,
        2 + 2 * i,
      );
    }

    const clips = await loadClips(ORG, stream, WINDOW, AT);

    expect(clips.length).toBeLessThanOrEqual(20);
    expect(select(clips, stream, AT, WINDOW).clipId).toBe("covering");
  });

  it("reads Segments that only open and close a Clip (body []) as a Clip from start to the closing end", async () => {
    const stream = streamOf("empty");
    clip(stream, "empty-clip", AT, AT + 10 * SECOND);

    expect(await loadClips(ORG, stream, WINDOW, AT)).toEqual([
      {
        clipId: "empty-clip",
        streamId: stream,
        serviceName: "web",
        start: new Date(AT),
        end: new Date(AT + 10 * SECOND),
      },
    ]);
  });

  it("makes one Clip of two opened in a run, with the id of the first and the end of the last Segment", async () => {
    const stream = streamOf("run");
    segment({ stream, index: 0, at: AT, start: AT, clipId: "first", trigger: "manual" });
    segment({
      stream,
      index: 1,
      at: AT + SECOND,
      end: AT + 2 * SECOND,
      start: AT,
      events: [event(AT + SECOND)],
    });
    segment({
      stream,
      index: 2,
      at: AT + 3 * SECOND,
      start: AT,
      clipId: "second",
      trigger: "error",
    });
    segment({ stream, index: 3, at: AT + 6 * SECOND, start: AT });

    const clips = await loadClips(ORG, stream, WINDOW, AT);

    expect(clips.map((c) => [c.clipId, c.start.getTime(), c.end.getTime()])).toEqual([
      ["first", AT, AT + 6 * SECOND],
    ]);
  });

  it("does not make a Clip of a run whose opening Segment was lost", async () => {
    const stream = streamOf("lost");
    segment({ stream, index: 4, at: AT, start: AT - SECOND, events: [event(AT)] });
    segment({ stream, index: 5, at: AT + SECOND, start: AT - SECOND });
    clip(stream, "kept", AT + 20 * SECOND, AT + 30 * SECOND, 6);

    const clips = await loadClips(ORG, stream, WINDOW, AT);

    expect(clips.map((c) => c.clipId)).toEqual(["kept"]);
  });

  it("counts a Clip once when every Segment was delivered twice", async () => {
    const stream = streamOf("twice");
    for (let i = 0; i < 2; i++) clip(stream, "twice", AT, AT + 10 * SECOND);

    const clips = await loadClips(ORG, stream, WINDOW, AT);

    expect(clips.map((c) => [c.clipId, c.start.getTime(), c.end.getTime()])).toEqual([
      ["twice", AT, AT + 10 * SECOND],
    ]);
  });

  it("ends a Clip at its last segment_end when no Segment closes it, as after an unload", async () => {
    const stream = streamOf("unload");
    segment({ stream, index: 0, at: AT, start: AT, clipId: "unloaded" });
    segment({
      stream,
      index: 1,
      at: AT + SECOND,
      end: AT + 4 * SECOND,
      start: AT,
      events: [event(AT + SECOND)],
    });

    const clips = await loadClips(ORG, stream, WINDOW, AT);

    expect(clips.map((c) => c.end.getTime())).toEqual([AT + 4 * SECOND]);
  });

  it("finds a Clip that started 23 hours before the window, and not one that started 25 hours before", async () => {
    const stream = streamOf("lookback");
    clip(stream, "old-enough", WINDOW.from.getTime() - 23 * HOUR, AT, 0);
    segment({
      stream,
      index: 2,
      at: WINDOW.from.getTime() - 25 * HOUR,
      start: WINDOW.from.getTime() - 25 * HOUR,
      clipId: "too-old",
    });
    segment({ stream, index: 3, at: AT, start: WINDOW.from.getTime() - 25 * HOUR });

    const clips = await loadClips(ORG, stream, WINDOW, AT);

    expect(clips.map((c) => c.clipId)).toEqual(["old-enough"]);
  });

  it("reads only the Stream asked for, and a Clip that ended before the window is out", async () => {
    const stream = streamOf("mine");
    clip(stream, "mine", AT, AT + 10 * SECOND);
    clip(streamOf("other"), "other", AT, AT + 10 * SECOND);
    clip(
      stream,
      "before",
      WINDOW.from.getTime() - 60 * SECOND,
      WINDOW.from.getTime() - 30 * SECOND,
      2,
    );

    const clips = await loadClips(ORG, stream, WINDOW, AT);

    expect(clips.map((c) => c.clipId)).toEqual(["mine"]);
  });
});

describe("the Clip of an id, as the player asks for it", () => {
  // Two Clips in one run on a Stream: `first` opens it, `second` opens
  // 3 seconds later. The events are in Segments of both.
  function twoClips(name: string, first: string, second: string) {
    const stream = streamOf(name);
    segment({
      stream,
      index: 0,
      at: AT,
      start: AT,
      clipId: `${name}-first`,
      trigger: first,
      events: [event(AT + 10)],
    });
    segment({
      stream,
      index: 1,
      at: AT + 3 * SECOND,
      start: AT,
      clipId: `${name}-second`,
      trigger: second,
      events: [event(AT + 3 * SECOND)],
    });
    segment({ stream, index: 2, at: AT + 5 * SECOND, start: AT, events: [event(AT + 5 * SECOND)] });
    return stream;
  }

  it("gives the run under the id of the second Clip, with the events of both", async () => {
    twoClips("both", "manual", "error");

    const { events, gaps } = await clipEvents(ORG, "both-second", AT);

    expect(gaps).toEqual([]);
    expect(events.map((e) => e.timestamp - AT)).toEqual([10, 3 * SECOND, 5 * SECOND]);
  });

  it("takes the trigger of the Clip asked for, not of the first in the run", async () => {
    // The second Clip's trigger is one this reader does not know: it is not placed,
    // and the first Clip of the same run still is.
    twoClips("unknown2", "manual", "from-a-future-sdk");
    await expect(clipEvents(ORG, "unknown2-second", AT)).rejects.toMatchObject({
      code: "outside_clip",
    });
    expect((await clipEvents(ORG, "unknown2-first", AT)).events).toHaveLength(3);

    // The first Clip's trigger is the unknown one: the second is placed.
    twoClips("unknown1", "from-a-future-sdk", "network");
    expect((await clipEvents(ORG, "unknown1-second", AT)).events).toHaveLength(3);
    await expect(clipEvents(ORG, "unknown1-first", AT)).rejects.toMatchObject({
      code: "outside_clip",
    });
  });

  it("ends the Clip at the last segment_end of the run, short of a later run", async () => {
    const stream = streamOf("end");
    segment({ stream, index: 0, at: AT, start: AT, clipId: "short" });
    segment({
      stream,
      index: 1,
      at: AT + SECOND,
      end: AT + 2 * SECOND,
      start: AT,
      events: [event(AT + SECOND)],
    });
    // A later run on the same Stream: its Segments are after the end of this one.
    segment({
      stream,
      index: 2,
      at: AT + 3 * SECOND,
      start: AT + 3 * SECOND,
      clipId: "later",
      events: [event(AT + 3 * SECOND)],
    });

    const { events } = await clipEvents(ORG, "short", AT);

    expect(events.map((e) => e.timestamp - AT)).toEqual([SECOND]);
  });

  it("reads Segments with the body [] as no events and no gap", async () => {
    const stream = streamOf("brackets");
    segment({ stream, index: 0, at: AT, start: AT, clipId: "brackets" });
    segment({ stream, index: 1, at: AT + SECOND, start: AT, events: [event(AT + SECOND)] });
    segment({ stream, index: 2, at: AT + 2 * SECOND, start: AT });

    const { events, gaps } = await clipEvents(ORG, "brackets", AT);

    expect(gaps).toEqual([]);
    expect(events.map((e) => e.timestamp - AT)).toEqual([SECOND]);
  });

  it("reads a Clip of Segments that are all [] as no events and no gap", async () => {
    const stream = streamOf("allempty");
    segment({ stream, index: 0, at: AT, start: AT, clipId: "allempty" });
    segment({ stream, index: 1, at: AT + SECOND, start: AT });

    expect(await clipEvents(ORG, "allempty", AT)).toEqual({ events: [], gaps: [] });
  });

  it("reads the events of a Clip from Segments an earlier run sent", async () => {
    const stream = streamOf("shared");
    // Run 1 sent the events of the Generation at AT - 20 s.
    segment({
      stream,
      index: 0,
      at: AT - 20 * SECOND,
      start: AT - 20 * SECOND,
      clipId: "run-one",
      events: [event(AT - 20 * SECOND)],
    });
    segment({
      stream,
      index: 1,
      at: AT - 10 * SECOND,
      start: AT - 20 * SECOND,
      events: [event(AT - 10 * SECOND)],
    });
    // Run 2 reaches back to that Generation and has nothing of its own to send but a close.
    segment({ stream, index: 2, at: AT, end: AT, start: AT - 20 * SECOND, clipId: "run-two" });

    const { events, gaps } = await clipEvents(ORG, "run-two", AT - 20 * SECOND);

    expect(gaps).toEqual([]);
    expect(events.map((e) => e.timestamp - AT)).toEqual([-20 * SECOND, -10 * SECOND]);
  });

  it("counts a Segment delivered twice once, and does not read a Clip it holds in two runs", async () => {
    const stream = streamOf("dup");
    for (let i = 0; i < 2; i++) {
      segment({
        stream,
        index: 0,
        at: AT,
        end: AT + SECOND,
        start: AT,
        clipId: "dup",
        events: [event(AT + 5)],
      });
    }
    const { events, gaps } = await clipEvents(ORG, "dup", AT);
    expect(gaps).toEqual([]);
    expect(events).toHaveLength(1);

    segment({ stream, index: 1, at: AT + SECOND, start: AT + SECOND, clipId: "dup" });
    await expect(clipEvents(ORG, "dup", AT)).rejects.toMatchObject({ code: "outside_clip" });
  });

  it("looks for the opening Segment an hour either side of --at", async () => {
    const stream = streamOf("hour");
    segment({ stream, index: 0, at: AT, start: AT, clipId: "hour" });

    await expect(clipEvents(ORG, "hour", AT + HOUR - SECOND)).resolves.toBeDefined();
    await expect(clipEvents(ORG, "hour", AT + HOUR + SECOND)).rejects.toMatchObject({
      code: "outside_clip",
    });
  });
});

// Send order is not time order when a later Clip reaches further back: Clip A
// (from Generation 5) sends Segments 0 to 2, then Clip B, opened by an error,
// sends Generation 4 as 3 to 5 (before A's start) and Generation 5 goes on as 6.
describe("Segments sent out of time order", () => {
  function setup(name: string, segments: [index: number, offsetMs: number][]) {
    const stream = streamOf(name);
    const clipId = `clip-${name}`;
    for (const [index, offsetMs] of segments) {
      // Segments before the Clip belong to Clip B's run, which starts 60 s back.
      segment({
        stream,
        index,
        at: AT + offsetMs,
        end: AT + 10 * SECOND,
        start: offsetMs < 0 ? AT - 60 * SECOND : AT,
        events: [event(AT + offsetMs)],
        ...(index === 0 ? { clipId } : {}),
      });
    }
    return { clipId, stream };
  }

  it("reports no gap when the missing indexes are Segments from before the Clip", async () => {
    const { clipId } = setup("a1", [
      [0, 100],
      [1, 200],
      [2, 300],
      [3, -60_000],
      [4, -50_000],
      [5, -40_000],
      [6, 400],
    ]);

    const { events, gaps } = await clipEvents(ORG, clipId, AT);

    expect(gaps).toEqual([]);
    expect(events.map((e) => e.timestamp - AT)).toEqual([100, 200, 300, 400]);
  });

  it("reports a gap for an index that no Segment of the Stream holds", async () => {
    const { clipId, stream } = setup("b1", [
      [0, 100],
      [1, 200],
      [2, 300],
      [3, -60_000],
      [5, -40_000],
      [6, 400],
    ]);

    const { gaps } = await clipEvents(ORG, clipId, AT);

    expect(gaps).toEqual([{ kind: "index", streamId: stream, after: 3, missing: 1 }]);
  });

  it("looks for Segments from before the Clip an hour back and no further", async () => {
    const { clipId, stream } = setup("c1", [
      [0, 100],
      [1, -3_600_000 - 1_000],
      [2, 300],
      [3, -3_000_000],
      [4, 400],
      [5, 500],
    ]);

    const { gaps } = await clipEvents(ORG, clipId, AT);

    // 1 is older than the bound: only that hole is reported.
    expect(gaps).toEqual([{ kind: "index", streamId: stream, after: 0, missing: 1 }]);
  });

  it("streams the Segments from before the Clip as body-less rows marked earlier, in index order", async () => {
    const { stream } = setup("d1", [
      [0, 100],
      [3, -60_000],
      [1, 200],
      [9, 3_000],
    ]);
    const lines = [];
    const found = (
      await segmentLines(
        ORG,
        {
          clipId: "clip-d1",
          streamId: stream,
          serviceName: "web",
          start: new Date(AT),
          end: new Date(AT + 10_000),
        },
        new Date(AT + 1_000),
      )
    )[Symbol.asyncIterator]();
    for (let next = await found.next(); !next.done; next = await found.next())
      lines.push(JSON.parse(next.value));

    expect(lines.map((l) => [l.segment_index, l.earlier, l.Body === ""])).toEqual([
      [0, 0, false],
      [1, 0, false],
      [3, 1, true],
    ]);
  });

  it("streams a Segment with the body [] like any other, holding no events", async () => {
    const stream = streamOf("e1");
    segment({ stream, index: 0, at: AT, start: AT, clipId: "clip-e1" });
    segment({ stream, index: 1, at: AT + 500, start: AT, events: [event(AT + 500)] });
    const found = await segmentLines(
      ORG,
      {
        clipId: "clip-e1",
        streamId: stream,
        serviceName: "web",
        start: new Date(AT),
        end: new Date(AT + 10_000),
      },
      new Date(AT + 1_000),
    );
    const lines = [];
    for await (const line of found) lines.push(JSON.parse(line));

    expect(lines.map((l) => [l.segment_index, l.earlier, l.Body])).toEqual([
      [0, 0, "[]"],
      [1, 0, JSON.stringify([event(AT + 500)])],
    ]);
  });
});
