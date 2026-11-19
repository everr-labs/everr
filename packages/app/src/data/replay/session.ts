import "@tanstack/react-start/server-only";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { query, queryLines } from "#app/lib/clickhouse.ts";
import { distance, hexId } from "./quote.ts";

const MAX_CLIPS = 20;
const MAX_SEGMENT_BYTES = 32 * 1024 * 1024;
/** When no Clip covers --at, the error names this many of the nearest. */
const NEAREST_CLIPS = 3;
/** Clips are searched this far either side of --at (overlap, plus the start lookback). */
const AT_RADIUS_MS = 5 * 60 * 1000;

/**
 * How far before a search window a Clip may start and still be found: a
 * buffered Clip starts at a Generation, which can be hours older than the
 * moment that cut it.
 */
const CLIP_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * ClickHouse renders DateTime64 through its query timezone, so civil-format
 * strings would be re-parsed by `new Date(...)` in the Node host's timezone
 * and silently shift by the offset between the two. Every timestamp crosses
 * the boundary as an epoch number instead (ISO-8601 UTC strings parse with
 * best_effort where a string parameter is unavoidable).
 */
const QUERY_SETTINGS = { date_time_input_format: "best_effort" } as const;

/** A time range. Epoch-ms precision; both ends included. */
export type TimeWindow = { from: Date; to: Date };

/** A Clip as the reader decodes its `recording` span: a time range of one Stream. */
export type ClipWindow = {
  clipId: string;
  streamId: string;
  serviceName: string;
  start: Date;
  end: Date;
};

/**
 * An expected outcome a caller can act on. The message is written for an
 * agent, in the words of the CLI flags, and quotes or validates every id it
 * names.
 */
export class ReplayError extends Error {
  constructor(
    readonly code: "bad_request" | "outside_clip" | "not_found" | "too_large",
    message: string,
  ) {
    super(message);
    this.name = "ReplayError";
  }
}

type SpanRow = { serviceName: string; startMs: number; endMs: number; clipId: string };

/** Where loadClips looks for the Clips around a moment: 5 minutes either side. */
export function windowAround(atMs: number): TimeWindow {
  return { from: new Date(atMs - AT_RADIUS_MS), to: new Date(atMs + AT_RADIUS_MS) };
}

/**
 * The Clips of one Stream whose [start, end] overlaps the window, at most
 * MAX_CLIPS: those covering `atMs` first (the one ending last first), then
 * the nearest. A Clip may start up to CLIP_LOOKBACK_MS before the window.
 */
export async function loadClips(
  organizationId: string,
  streamId: string,
  window: TimeWindow,
  atMs: number,
): Promise<ClipWindow[]> {
  const rows = await query<SpanRow>(
    `
SELECT
  ServiceName AS serviceName,
  toUnixTimestamp64Milli(Timestamp) AS startMs,
  toUnixTimestamp64Milli(Timestamp) + intDiv(Duration, 1000000) AS endMs,
  toString(SpanAttributes.\`everr.recording.clip.id\`) AS clipId
FROM traces
WHERE SpanName = 'recording'
  AND toString(SpanAttributes.\`everr.recording.stream.id\`) = {stream:String}
  AND Timestamp >= fromUnixTimestamp64Milli({startFromMs: Int64})
  AND Timestamp <= fromUnixTimestamp64Milli({toMs: Int64})
  AND Timestamp + toIntervalNanosecond(Duration) >= fromUnixTimestamp64Milli({fromMs: Int64})
ORDER BY greatest(0, startMs - {atMs:Int64}, {atMs:Int64} - endMs), endMs DESC
LIMIT 1 BY clipId
LIMIT {cap:UInt16}
`,
    organizationId,
    {
      stream: streamId,
      startFromMs: window.from.getTime() - CLIP_LOOKBACK_MS,
      fromMs: window.from.getTime(),
      toMs: window.to.getTime(),
      atMs,
      cap: MAX_CLIPS,
    },
    QUERY_SETTINGS,
  );
  // A span without a Clip id or a service names no Segments to read.
  return rows
    .filter((r) => r.clipId && r.serviceName)
    .map((r) => ({
      clipId: r.clipId,
      streamId,
      serviceName: r.serviceName,
      start: new Date(Number(r.startMs)),
      end: new Date(Number(r.endMs)),
    }));
}

const covers = (c: ClipWindow, ms: number) => c.start.getTime() <= ms && ms <= c.end.getTime();

/**
 * The Clip to read the page at `atMs` from: of the Clips covering it, the one
 * that ends last, so the page can be read the furthest after it. None found is
 * not_found; none covering is outside_clip naming the nearest.
 */
export function select(
  clips: ClipWindow[],
  streamId: string,
  atMs: number,
  window: TimeWindow,
): ClipWindow {
  const covering = clips
    .filter((c) => covers(c, atMs))
    .sort((a, b) => b.end.getTime() - a.end.getTime())[0];
  if (covering) return covering;
  const stream = `stream ${hexId(streamId)}`;
  if (clips.length === 0) {
    throw new ReplayError(
      "not_found",
      `No Clip of ${stream} overlaps ${window.from.toISOString()}..${window.to.toISOString()} (5 minutes either side of --at). Find Clips in the \`recording\` spans of \`traces\`.`,
    );
  }
  const gap = (c: ClipWindow) =>
    atMs < c.start.getTime() ? c.start.getTime() - atMs : atMs - c.end.getTime();
  const nearest = [...clips]
    .sort((a, b) => gap(a) - gap(b))
    .slice(0, NEAREST_CLIPS)
    .map(
      (c) =>
        `clip ${hexId(c.clipId)} ${c.start.toISOString()}..${c.end.toISOString()} (${
          atMs < c.start.getTime()
            ? `starts ${distance(gap(c))} after`
            : `ends ${distance(gap(c))} before`
        } that instant)`,
    );
  throw new ReplayError(
    "outside_clip",
    `No Clip covers ${new Date(atMs).toISOString()} in ${stream}. Nearest: ${nearest.join("; ")}. Pass an --at inside a Clip.`,
  );
}

// The Segments of a Clip's Stream, from the Clip's start up to a moment.
const SEGMENT_SCOPE = `
FROM recordings
WHERE ServiceName = {service:String}
  AND stream_id = {stream:String}
  AND Timestamp >= fromUnixTimestamp64Nano(toInt64({fromMs: Int64}) * 1000000)
  AND Timestamp <= fromUnixTimestamp64Nano(toInt64({toMs: Int64}) * 1000000)`;

const segmentScope = (clip: ClipWindow, at: Date) => ({
  service: clip.serviceName,
  stream: clip.streamId,
  fromMs: clip.start.getTime(),
  toMs: at.getTime(),
});

/** The Body bytes of the Segments the page at `at` needs. */
async function segmentBytes(organizationId: string, clip: ClipWindow, at: Date): Promise<number> {
  const [row] = await query<{ bytes: number }>(
    `SELECT sum(length(Body)) AS bytes${SEGMENT_SCOPE}`,
    organizationId,
    segmentScope(clip, at),
    QUERY_SETTINGS,
  );
  return Number(row?.bytes ?? 0);
}

const SEGMENT_COLUMNS = `
SELECT
  segment_index,
  Body,
  toString(LogAttributes.\`everr.recording.event.index\`) AS event_index,
  toString(LogAttributes.\`everr.recording.event.piece\`) AS piece,
  toString(LogAttributes.\`everr.recording.event.pieces\`) AS pieces`;

/**
 * The Segment rows the page at `at` needs, from the Clip's start, as the JSON
 * lines ClickHouse writes: `{segment_index, Body, event_index, piece,
 * pieces}`. They are passed on unparsed: the CLI rebuilds the page. A read
 * over MAX_SEGMENT_BYTES is refused before any row is read.
 */
export async function segmentLines(
  organizationId: string,
  clip: ClipWindow,
  at: Date,
): Promise<AsyncIterable<string>> {
  const bytes = await segmentBytes(organizationId, clip, at);
  if (bytes > MAX_SEGMENT_BYTES) {
    throw new ReplayError(
      "too_large",
      `The page at ${at.toISOString()} needs ${Math.ceil(bytes / 1024 / 1024)} MiB of Segments, over the ${MAX_SEGMENT_BYTES / 1024 / 1024} MiB a read allows.`,
    );
  }
  return queryLines(
    `${SEGMENT_COLUMNS}${SEGMENT_SCOPE}
ORDER BY segment_index
`,
    organizationId,
    segmentScope(clip, at),
    QUERY_SETTINGS,
  );
}

// The in-app player: every event of one Clip, parsed here and sent to the
// browser that plays it.

type RrwebEvent = {
  type: number;
  timestamp: number;
  data: Record<string, unknown>;
};

type Gap =
  | { kind: "index"; streamId: string; after: number; missing: number }
  | { kind: "piece"; streamId: string; eventIndex: number }
  | { kind: "conflict"; streamId: string; segmentIndex: number };

export type ClipEvents = { events: RrwebEvent[]; gaps: Gap[] };

type ClipSpanRow = SpanRow & { streamId: string; trigger: string; sessionId: string };

/**
 * The Clip of a `recording` span, by its id. `atMs` is the Clip's start: the
 * span is searched an hour either side of it. None, two different spans, or a
 * span missing its Stream, service, Session or trigger is undefined.
 */
async function loadClipById(
  organizationId: string,
  clipId: string,
  atMs: number,
): Promise<ClipWindow | undefined> {
  const lookbackMs = 60 * 60 * 1000;
  const rows = await query<ClipSpanRow>(
    `
SELECT
  ServiceName AS serviceName,
  toUnixTimestamp64Milli(Timestamp) AS startMs,
  toUnixTimestamp64Milli(Timestamp) + intDiv(Duration, 1000000) AS endMs,
  toString(SpanAttributes.\`everr.recording.clip.id\`) AS clipId,
  toString(SpanAttributes.\`everr.recording.stream.id\`) AS streamId,
  toString(SpanAttributes.\`everr.recording.trigger\`) AS trigger,
  toString(SpanAttributes.\`session.id\`) AS sessionId
FROM traces
WHERE SpanName = 'recording'
  AND toString(SpanAttributes.\`everr.recording.clip.id\`) = {clipId:String}
  AND Timestamp >= fromUnixTimestamp64Milli({fromMs: Int64})
  AND Timestamp <= fromUnixTimestamp64Milli({toMs: Int64})
ORDER BY Timestamp ASC
LIMIT 1 BY clipId
`,
    organizationId,
    { clipId, fromMs: atMs - lookbackMs, toMs: atMs + lookbackMs },
    QUERY_SETTINGS,
  );
  // `LIMIT 1 BY clipId` collapses rows duplicated by at-least-once delivery on
  // the server; the dedupe here keeps the same guarantee behind a mock or a
  // future server change. Two DIFFERENT shapes for one clip id stay rejected.
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    const identity = `${r.clipId}:${r.startMs}:${r.endMs}:${r.streamId}:${r.serviceName}:${r.sessionId}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
  if (deduped.length !== 1) return undefined;
  const r = deduped[0];
  if (!r?.clipId || !r.streamId || !r.serviceName || !r.sessionId) return undefined;
  if (r.trigger !== "error" && r.trigger !== "network" && r.trigger !== "manual") return undefined;
  return {
    clipId: r.clipId,
    streamId: r.streamId,
    serviceName: r.serviceName,
    start: new Date(Number(r.startMs)),
    end: new Date(Number(r.endMs)),
  };
}

type StoredSegment = {
  segmentIndex: number;
  body: string;
  eventIndex: string;
  piece: string;
  pieces: string;
};

type SegmentRow = {
  segment_index: number;
  Body: string;
  event_index: string;
  piece: string;
  pieces: string;
};

/** The Segments of a Clip's Stream from its start to its end, each index once. */
async function loadSegments(
  organizationId: string,
  clip: ClipWindow,
): Promise<{ segments: StoredSegment[]; gaps: Gap[] }> {
  const rows = await query<SegmentRow>(
    `${SEGMENT_COLUMNS}${SEGMENT_SCOPE}
ORDER BY segment_index
`,
    organizationId,
    segmentScope(clip, clip.end),
    QUERY_SETTINGS,
  );

  let bytes = 0;
  const gaps: Gap[] = [];
  const segments: StoredSegment[] = [];
  const seen = new Map<number, string>();

  for (const row of rows) {
    bytes += Buffer.byteLength(row.Body);
    if (bytes > MAX_SEGMENT_BYTES) {
      throw new ReplayError("too_large", "recording segment payload exceeds 32 MiB");
    }
    const index = Number(row.segment_index);
    const prior = seen.get(index);
    if (prior !== undefined) {
      if (prior !== row.Body) {
        gaps.push({ kind: "conflict", streamId: clip.streamId, segmentIndex: index });
      }
      continue;
    }
    seen.set(index, row.Body);
    segments.push({
      segmentIndex: index,
      body: row.Body,
      eventIndex: row.event_index,
      piece: row.piece,
      pieces: row.pieces,
    });
  }

  return { segments, gaps };
}

function reassemble(
  segments: StoredSegment[],
  streamId: string,
): { events: RrwebEvent[]; gaps: Gap[] } {
  const ordered = [...segments].sort((a, b) => a.segmentIndex - b.segmentIndex);
  const events: RrwebEvent[] = [];
  const gaps: Gap[] = [];
  const open = new Map<string, { parts: string[]; count: number }>();

  const first = ordered[0];
  if (first) {
    let expect = first.segmentIndex;
    for (const s of ordered) {
      if (s.segmentIndex > expect) {
        gaps.push({
          kind: "index",
          streamId,
          after: expect - 1,
          missing: s.segmentIndex - expect,
        });
      }
      expect = s.segmentIndex + 1;
    }
  }

  for (const s of ordered) {
    if (!s.pieces) {
      try {
        const parsed: unknown = JSON.parse(s.body);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (isRrwebEvent(item)) events.push(item);
          }
        }
      } catch {
        gaps.push({ kind: "piece", streamId, eventIndex: s.segmentIndex });
      }
      continue;
    }
    const key = s.eventIndex;
    const count = Number(s.pieces);
    const slot = open.get(key) ?? { parts: [], count };
    slot.parts[Number(s.piece)] = s.body;
    slot.count = count;
    open.set(key, slot);
    if (slot.parts.filter((p) => p !== undefined).length === count) {
      try {
        const parsed: unknown = JSON.parse(slot.parts.join(""));
        if (isRrwebEvent(parsed)) events.push(parsed);
      } catch {
        gaps.push({ kind: "piece", streamId, eventIndex: Number(key) || s.segmentIndex });
      }
      open.delete(key);
    }
  }
  for (const [key] of open) {
    gaps.push({ kind: "piece", streamId, eventIndex: Number(key) || 0 });
  }
  return { events, gaps };
}

function isRrwebEvent(value: unknown): value is RrwebEvent {
  if (!value || typeof value !== "object") return false;
  if (!("type" in value) || !("timestamp" in value) || !("data" in value)) return false;
  return (
    typeof value.type === "number" &&
    typeof value.timestamp === "number" &&
    typeof value.data === "object" &&
    value.data !== null
  );
}

/**
 * The events of one Clip in time order, for the in-app player, ending at the
 * Clip's end. `atMs` is the Clip's start: its span is searched an hour around it.
 */
export async function clipEvents(
  organizationId: string,
  clipId: string,
  atMs: number,
): Promise<ClipEvents> {
  const clip = await loadClipById(organizationId, clipId, atMs);
  if (!clip) throw new ReplayError("outside_clip", "no recording clip found near at");
  const { segments, gaps } = await loadSegments(organizationId, clip);
  const { events, gaps: streamGaps } = reassemble(segments, clip.streamId);
  const endMs = clip.end.getTime();
  return {
    events: events.filter((e) => e.timestamp <= endMs).sort((a, b) => a.timestamp - b.timestamp),
    gaps: [...gaps, ...streamGaps],
  };
}

/**
 * A ReplayError as the route's JSON answer `{ error, message }`. Anything else
 * is an opaque 500, logged and recorded on the request span: the route catches
 * it, so nothing upstream sees it.
 */
export function replayHttpError(error: unknown): Response {
  if (error instanceof ReplayError) {
    const status = error.code === "bad_request" ? 400 : error.code === "too_large" ? 413 : 404;
    return Response.json({ error: error.code, message: error.message }, { status });
  }
  console.error("recording read failed", error);
  const span = trace.getActiveSpan();
  span?.recordException(error instanceof Error ? error : String(error));
  span?.setStatus({ code: SpanStatusCode.ERROR });
  return Response.json({ error: "internal" }, { status: 500 });
}
