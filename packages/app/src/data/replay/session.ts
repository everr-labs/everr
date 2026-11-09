import "@tanstack/react-start/server-only";

import { query } from "#app/lib/clickhouse.ts";
import { CUSTOM, createMirror, INCREMENTAL, INPUT, META, MOUSE_INTERACTION } from "./mirror.ts";

const MAX_CLIPS = 20;
const MAX_SEGMENT_BYTES = 32 * 1024 * 1024;
const MAX_STEPS = 500;
const WINDOW_MAX_MS = 24 * 60 * 60 * 1000;

/**
 * ClickHouse renders DateTime64 through its query timezone, so civil-format
 * strings would be re-parsed by `new Date(...)` in the Node host's timezone
 * and silently shift by the offset between the two. Every timestamp crosses
 * the boundary as an epoch number instead (ISO-8601 UTC strings parse with
 * best_effort where a string parameter is unavoidable).
 */
const QUERY_SETTINGS = { date_time_input_format: "best_effort" } as const;

type Trigger = "error" | "network" | "manual";

type ClipWindow = {
  clipId: string;
  streamId: string;
  sessionId: string;
  serviceName: string;
  start: Date;
  end: Date;
  trigger: Trigger;
  bufferTruncated: boolean;
};

type StoredSegment = {
  streamId: string;
  segmentIndex: number;
  body: string;
  eventIndex: string;
  piece: string;
  pieces: string;
};

type RrwebEvent = {
  type: number;
  timestamp: number;
  data: Record<string, unknown>;
};

type Gap =
  | { kind: "index"; streamId: string; after: number; missing: number }
  | { kind: "piece"; streamId: string; eventIndex: number }
  | { kind: "conflict"; streamId: string; segmentIndex: number }
  | { kind: "clip"; atMs: number; reason: string }
  /**
   * The journey kept to its byte budget: "pieces" read the stream without its
   * snapshots over 950 KB (its steps before the next small snapshot have no
   * target), "stream" left the stream out.
   */
  | { kind: "budget"; streamId: string; skipped: "pieces" | "stream" };

type JourneyStep =
  | { kind: "page"; at: string; streamId: string; url: string }
  | { kind: "click"; at: string; streamId: string; target: string | null }
  /** One step per run of input events on the same element. */
  | { kind: "input"; at: string; streamId: string; target: string | null }
  | { kind: "pause" | "resume"; at: string; streamId: string };

export type SessionJourney = {
  sessionId: string;
  windowStart: string;
  windowEnd: string;
  truncated: boolean;
  clips: Array<{
    clipId: string;
    streamId: string;
    serviceName: string;
    trigger: Trigger;
    truncated: boolean;
    start: string;
    end: string;
  }>;
  steps: JourneyStep[];
  gaps: Gap[];
  facts: {
    pages: number;
    clicks: number;
    inputs: number;
    clipsByTrigger: Record<Trigger, number>;
    gapCount: number;
  };
};

export type PageSnapshot = {
  sessionId: string;
  streamId: string;
  clipId: string;
  at: string;
  url: string;
  /** The page at `at`: the last full snapshot with every change after it applied. */
  html: string;
  /** Incomplete when a Segment is missing or a change named a node the page did not have. */
  coverage: "complete" | "incomplete";
};

class ReplayError extends Error {
  constructor(
    readonly code: "bad_request" | "outside_clip" | "ambiguous_stream" | "too_large",
    message: string,
    readonly streams?: string[],
  ) {
    super(message);
    this.name = "ReplayError";
  }
}

/**
 * An unrecognized trigger value skips the span where it is read (recorded as a
 * "clip" gap), so a future producer version cannot fail a whole session.
 */
function parseTrigger(raw: string): Trigger | undefined {
  if (raw === "error" || raw === "network" || raw === "manual") return raw;
  return undefined;
}

function iso(d: Date): string {
  return d.toISOString();
}

function parseInstant(raw: string): Date {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new ReplayError("bad_request", "at must be an ISO-8601 timestamp");
  }
  return d;
}

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

async function loadClips(
  organizationId: string,
  sessionId: string,
  from: Date,
  to: Date,
): Promise<{ clips: ClipWindow[]; gaps: Gap[]; more: boolean }> {
  const rows = await query<SpanRow>(
    `
SELECT
  ServiceName AS serviceName,
  toUnixTimestamp64Milli(Timestamp) AS startMs,
  toUnixTimestamp64Milli(Timestamp) + intDiv(Duration, 1000000) AS endMs,
  toString(SpanAttributes.\`everr.recording.clip.id\`) AS clipId,
  toString(SpanAttributes.\`everr.recording.stream.id\`) AS streamId,
  toString(SpanAttributes.\`everr.recording.trigger\`) AS trigger,
  toString(SpanAttributes.\`everr.recording.clip.truncated\`) AS truncated,
  toString(SpanAttributes.\`session.id\`) AS sessionId
FROM traces
WHERE SpanName = 'recording'
  AND toString(SpanAttributes.\`session.id\`) = {sessionId:String}
  AND Timestamp >= fromUnixTimestamp64Milli({fromMs: Int64})
  AND Timestamp < fromUnixTimestamp64Milli({toMs: Int64})
ORDER BY Timestamp DESC
LIMIT 1 BY clipId, streamId
LIMIT {cap:UInt16}
`,
    organizationId,
    // One more than the cap tells a full window from a truncated one.
    { sessionId, fromMs: from.getTime(), toMs: to.getTime(), cap: MAX_CLIPS + 1 },
    QUERY_SETTINGS,
  );

  const clips: ClipWindow[] = [];
  const gaps: Gap[] = [];
  for (const r of rows.slice(0, MAX_CLIPS)) {
    if (!r.clipId || !r.streamId || !r.serviceName) {
      gaps.push({
        kind: "clip",
        atMs: Number(r.startMs ?? 0),
        reason: "recording span missing clip, stream, or service",
      });
      continue;
    }
    const trigger = parseTrigger(r.trigger ?? "");
    if (!trigger) {
      gaps.push({
        kind: "clip",
        atMs: Number(r.startMs ?? 0),
        reason: `unknown recording trigger: ${r.trigger ?? ""}`,
      });
      continue;
    }
    clips.push({
      clipId: r.clipId,
      streamId: r.streamId,
      sessionId: r.sessionId || sessionId,
      serviceName: r.serviceName,
      start: new Date(r.startMs),
      end: new Date(r.endMs),
      trigger,
      bufferTruncated: r.truncated === "true",
    });
  }
  return { clips, gaps, more: rows.length > MAX_CLIPS };
}

async function loadClipById(
  organizationId: string,
  clipId: string,
  atMs: number,
): Promise<ClipWindow | undefined> {
  const lookbackMs = 60 * 60 * 1000;
  const rows = await query<SpanRow>(
    `
SELECT
  ServiceName AS serviceName,
  toUnixTimestamp64Milli(Timestamp) AS startMs,
  toUnixTimestamp64Milli(Timestamp) + intDiv(Duration, 1000000) AS endMs,
  toString(SpanAttributes.\`everr.recording.clip.id\`) AS clipId,
  toString(SpanAttributes.\`everr.recording.stream.id\`) AS streamId,
  toString(SpanAttributes.\`everr.recording.trigger\`) AS trigger,
  toString(SpanAttributes.\`everr.recording.clip.truncated\`) AS truncated,
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
  const trigger = parseTrigger(r.trigger ?? "");
  if (!trigger) return undefined;
  return {
    clipId: r.clipId,
    streamId: r.streamId,
    sessionId: r.sessionId,
    serviceName: r.serviceName,
    start: new Date(r.startMs),
    end: new Date(r.endMs),
    trigger,
    bufferTruncated: r.truncated === "true",
  };
}

type SegmentRow = {
  stream_id: string;
  segment_index: number;
  Body: string;
  event_index: string;
  piece: string;
  pieces: string;
};

// The rows of the Segments of some windows: their streams, in the time range
// that covers them all. The SQL fragment selects the piece rows.
const SEGMENT_SCOPE = `
FROM recordings
WHERE ServiceName IN {services:Array(String)}
  AND stream_id IN {streams:Array(String)}
  AND Timestamp >= fromUnixTimestamp64Nano(toInt64({fromMs: Int64}) * 1000000)
  AND Timestamp <= fromUnixTimestamp64Nano(toInt64({toMs: Int64}) * 1000000)`;
const IS_PIECE = "toString(LogAttributes.`everr.recording.event.pieces`) != ''";

function segmentScope(windows: ClipWindow[]) {
  return {
    services: [...new Set(windows.map((w) => w.serviceName))],
    streams: [...new Set(windows.map((w) => w.streamId))],
    fromMs: Math.min(...windows.map((w) => w.start.getTime())),
    toMs: Math.max(...windows.map((w) => w.end.getTime())),
  };
}

type StreamBytes = { stream_id: string; bytes: number; piece_bytes: number };

/** The Body bytes of each stream in the windows, and how many of them are snapshot pieces. */
async function segmentBytes(
  organizationId: string,
  windows: ClipWindow[],
): Promise<Map<string, { bytes: number; pieceBytes: number }>> {
  const rows = await query<StreamBytes>(
    `
SELECT
  stream_id,
  sum(length(Body)) AS bytes,
  sumIf(length(Body), ${IS_PIECE}) AS piece_bytes
${SEGMENT_SCOPE}
GROUP BY stream_id
`,
    organizationId,
    segmentScope(windows),
    QUERY_SETTINGS,
  );
  return new Map(
    rows.map((r) => [r.stream_id, { bytes: Number(r.bytes), pieceBytes: Number(r.piece_bytes) }]),
  );
}

async function loadSegments(
  organizationId: string,
  windows: ClipWindow[],
  /** Streams read without their snapshot pieces. */
  withoutPieces: string[] = [],
): Promise<{ byStream: Map<string, StoredSegment[]>; gaps: Gap[] }> {
  if (windows.length === 0) return { byStream: new Map(), gaps: [] };

  const rows = await query<SegmentRow>(
    `
SELECT
  stream_id,
  segment_index,
  Body,
  toString(LogAttributes.\`everr.recording.event.index\`) AS event_index,
  toString(LogAttributes.\`everr.recording.event.piece\`) AS piece,
  toString(LogAttributes.\`everr.recording.event.pieces\`) AS pieces
${SEGMENT_SCOPE}${withoutPieces.length ? `\n  AND NOT (stream_id IN {withoutPieces:Array(String)} AND ${IS_PIECE})` : ""}
ORDER BY stream_id, segment_index
`,
    organizationId,
    { ...segmentScope(windows), withoutPieces },
    QUERY_SETTINGS,
  );

  let bytes = 0;
  const gaps: Gap[] = [];
  const byStream = new Map<string, StoredSegment[]>();
  const seen = new Map<string, string>();

  for (const row of rows) {
    bytes += Buffer.byteLength(row.Body);
    if (bytes > MAX_SEGMENT_BYTES) {
      throw new ReplayError("too_large", "recording segment payload exceeds 32 MiB");
    }
    const key = `${row.stream_id}:${row.segment_index}`;
    const prior = seen.get(key);
    if (prior !== undefined) {
      if (prior !== row.Body) {
        gaps.push({ kind: "conflict", streamId: row.stream_id, segmentIndex: row.segment_index });
      }
      continue;
    }
    seen.set(key, row.Body);

    const list = byStream.get(row.stream_id) ?? [];
    list.push({
      streamId: row.stream_id,
      segmentIndex: Number(row.segment_index),
      body: row.Body,
      eventIndex: row.event_index,
      piece: row.piece,
      pieces: row.pieces,
    });
    byStream.set(row.stream_id, list);
  }

  return { byStream, gaps };
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

/**
 * Walks the events of one stream in order through a mirror of its page, and
 * gives the steps of the events inside a Clip: pages, pauses, clicks, and runs
 * of input, each click and input named by its element as the page was then.
 */
function projectSteps(
  streamId: string,
  events: RrwebEvent[],
  inClip: (time: number) => boolean,
  cap: number,
): { steps: JourneyStep[]; truncated: boolean } {
  const steps: JourneyStep[] = [];
  const mirror = createMirror();
  let lastInput: number | undefined;
  for (const e of events) {
    const input = inputId(e);
    const step = inClip(e.timestamp) && stepOf(streamId, e, mirror.describe, input, lastInput);
    if (step) {
      if (steps.length >= cap) return { steps, truncated: true };
      steps.push(step);
      // Any step ends a run of input; an input step starts one.
      lastInput = input;
    }
    mirror.apply(e);
  }
  return { steps, truncated: false };
}

// rrweb MouseInteractions values that are a click.
const CLICK = 2;
const DBL_CLICK = 4;

const inputId = (e: RrwebEvent) =>
  e.type === INCREMENTAL && e.data.source === INPUT && typeof e.data.id === "number"
    ? e.data.id
    : undefined;

function stepOf(
  streamId: string,
  e: RrwebEvent,
  describe: (id: number) => string | null,
  input: number | undefined,
  lastInput: number | undefined,
): JourneyStep | undefined {
  const at = () => new Date(e.timestamp).toISOString();
  if (e.type === META) {
    const url = typeof e.data.href === "string" ? e.data.href : "";
    return { kind: "page", at: at(), streamId, url };
  }
  if (e.type === CUSTOM) {
    const tag = typeof e.data.tag === "string" ? e.data.tag : "";
    if (tag === "everr.recording.pause") return { kind: "pause", at: at(), streamId };
    if (tag === "everr.recording.resume") return { kind: "resume", at: at(), streamId };
    return;
  }
  if (input !== undefined) {
    if (input === lastInput) return;
    return { kind: "input", at: at(), streamId, target: describe(input) };
  }
  if (
    e.type === INCREMENTAL &&
    e.data.source === MOUSE_INTERACTION &&
    (e.data.type === CLICK || e.data.type === DBL_CLICK)
  ) {
    const target = typeof e.data.id === "number" ? describe(e.data.id) : null;
    return { kind: "click", at: at(), streamId, target };
  }
  return;
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

function emptyJourney(sessionId: string, from: Date, to: Date): SessionJourney {
  return {
    sessionId,
    windowStart: iso(from),
    windowEnd: iso(to),
    truncated: false,
    clips: [],
    steps: [],
    gaps: [],
    facts: {
      pages: 0,
      clicks: 0,
      inputs: 0,
      clipsByTrigger: { error: 0, network: 0, manual: 0 },
      gapCount: 0,
    },
  };
}

function asDate(value: string | Date | undefined, label: string): Date | undefined {
  if (value === undefined) return undefined;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new ReplayError("bad_request", `${label} must be a valid timestamp`);
    }
    return value;
  }
  return parseInstant(value);
}

/**
 * The Segments of a journey within MAX_SEGMENT_BYTES, newest stream first. A
 * stream that does not fit whole is read without its snapshot pieces, and one
 * that does not fit even so is left out; each is a "budget" gap.
 */
async function loadJourneySegments(
  organizationId: string,
  windows: ClipWindow[],
): Promise<{ byStream: Map<string, StoredSegment[]>; gaps: Gap[]; truncated: boolean }> {
  if (windows.length === 0) return { byStream: new Map(), gaps: [], truncated: false };
  const sizes = await segmentBytes(organizationId, windows);
  const newest = new Map<string, number>();
  for (const w of windows)
    newest.set(w.streamId, Math.max(newest.get(w.streamId) ?? 0, w.end.getTime()));
  let left = MAX_SEGMENT_BYTES;
  const kept = new Set<string>();
  const withoutPieces: string[] = [];
  const gaps: Gap[] = [];
  for (const [streamId] of [...newest].sort((a, b) => b[1] - a[1])) {
    const size = sizes.get(streamId) ?? { bytes: 0, pieceBytes: 0 };
    if (size.bytes <= left) {
      kept.add(streamId);
      left -= size.bytes;
    } else if (size.bytes - size.pieceBytes <= left) {
      kept.add(streamId);
      withoutPieces.push(streamId);
      left -= size.bytes - size.pieceBytes;
      gaps.push({ kind: "budget", streamId, skipped: "pieces" });
    } else {
      gaps.push({ kind: "budget", streamId, skipped: "stream" });
    }
  }
  const loaded = await loadSegments(
    organizationId,
    windows.filter((w) => kept.has(w.streamId)),
    withoutPieces,
  );
  return {
    byStream: loaded.byStream,
    gaps: [...gaps, ...loaded.gaps],
    truncated: gaps.length > 0,
  };
}

export async function sessionJourney(
  organizationId: string,
  sessionId: string,
  range?: { from?: string | Date; to?: string | Date },
): Promise<SessionJourney> {
  if (!organizationId || !sessionId) {
    throw new ReplayError("bad_request", "sessionId is required");
  }
  // The window is capped at 24 hours on every call, including the implicit
  // default: `to` without `from` and a no-window call pick the same default
  // lookback, so scans of `traces` stay inside a day.
  const to = asDate(range?.to, "to") ?? new Date();
  const from = asDate(range?.from, "from") ?? new Date(to.getTime() - WINDOW_MAX_MS);
  if (!(from < to)) {
    throw new ReplayError("bad_request", "from must be before to");
  }
  if (to.getTime() - from.getTime() > WINDOW_MAX_MS) {
    throw new ReplayError("bad_request", "from/to window must be at most 24 hours");
  }

  const { clips, gaps: clipGaps, more } = await loadClips(organizationId, sessionId, from, to);
  if (clips.length === 0) {
    const empty = emptyJourney(sessionId, from, to);
    return {
      ...empty,
      gaps: clipGaps,
      facts: { ...empty.facts, gapCount: clipGaps.length },
    };
  }

  const overlapping = clips.filter((c) => c.end >= from && c.start <= to);
  const {
    byStream,
    gaps: loadGaps,
    truncated: overBudget,
  } = await loadJourneySegments(organizationId, overlapping);
  const gaps = [...clipGaps, ...loadGaps];
  let truncated = more || overBudget;

  // The step cap is enforced over all streams at the end (after sorting), so
  // a single busy stream cannot hide another stream's earliest steps.
  let steps: JourneyStep[] = [];
  for (const [streamId, segs] of byStream) {
    const streamClips = overlapping.filter((c) => c.streamId === streamId);
    const { events, gaps: streamGaps } = reassemble(segs, streamId);
    gaps.push(...streamGaps);
    const projected = projectSteps(
      streamId,
      events,
      (time) => streamClips.some((c) => time >= c.start.getTime() && time <= c.end.getTime()),
      MAX_STEPS,
    );
    if (projected.truncated) truncated = true;
    steps.push(...projected.steps);
  }

  steps.sort((a, b) => a.at.localeCompare(b.at));
  if (steps.length > MAX_STEPS) truncated = true;
  steps = steps.slice(0, MAX_STEPS);

  const clipsByTrigger: Record<Trigger, number> = { error: 0, network: 0, manual: 0 };
  for (const c of overlapping) clipsByTrigger[c.trigger]++;

  return {
    sessionId,
    windowStart: iso(from),
    windowEnd: iso(to),
    truncated,
    clips: overlapping
      .slice()
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map((c) => ({
        clipId: c.clipId,
        streamId: c.streamId,
        serviceName: c.serviceName,
        trigger: c.trigger,
        truncated: c.bufferTruncated,
        start: iso(c.start),
        end: iso(c.end),
      })),
    steps,
    gaps,
    facts: {
      pages: steps.filter((s) => s.kind === "page").length,
      clicks: steps.filter((s) => s.kind === "click").length,
      inputs: steps.filter((s) => s.kind === "input").length,
      clipsByTrigger,
      gapCount: gaps.length,
    },
  };
}

export async function pageAt(
  organizationId: string,
  request: { sessionId?: string; clipId?: string; at: string; streamId?: string },
  /** `compact` gives the body only, without scripts, styles, or drawing. */
  options: { compact?: boolean } = {},
): Promise<PageSnapshot> {
  if (!organizationId) throw new ReplayError("bad_request", "missing organization");
  if (!request.at) throw new ReplayError("bad_request", "at is required");
  const at = parseInstant(request.at);
  const atMs = at.getTime();

  let clip: ClipWindow | undefined;
  if (request.clipId) {
    clip = await loadClipById(organizationId, request.clipId, atMs);
    if (!clip) throw new ReplayError("outside_clip", "no recording clip found near at");
    // The clip must belong to the session in the request: a clip id from
    // another organization's session never resolves here (tenant isolation),
    // but one from another session of the same organization must not either.
    if (request.sessionId && clip.sessionId !== request.sessionId) {
      throw new ReplayError("outside_clip", "clip belongs to another session");
    }
  } else {
    if (!request.sessionId) {
      throw new ReplayError("bad_request", "sessionId or clipId is required");
    }
    const from = new Date(atMs - WINDOW_MAX_MS);
    const to = new Date(atMs + 60 * 60 * 1000);
    const { clips } = await loadClips(organizationId, request.sessionId, from, to);
    const covering = clips.filter((c) => c.start <= at && c.end >= at);
    const byStream = request.streamId
      ? covering.filter((c) => c.streamId === request.streamId)
      : covering;
    const streams = [...new Set(byStream.map((c) => c.streamId))];
    if (streams.length > 1) {
      throw new ReplayError("ambiguous_stream", "multiple streams cover at", streams);
    }
    if (byStream.length === 0) {
      throw new ReplayError("outside_clip", "no recording clip covers at");
    }
    clip = byStream.sort((a, b) => a.start.getTime() - b.start.getTime())[0];
  }

  if (!clip) {
    throw new ReplayError("outside_clip", "no recording clip covers at");
  }
  if (at < clip.start || at > clip.end) {
    throw new ReplayError("outside_clip", "at is outside the clip span");
  }

  // Only the events up to `at` are replayed.
  const { byStream, gaps } = await loadSegments(organizationId, [{ ...clip, end: at }]);
  const segs = byStream.get(clip.streamId) ?? [];
  const { events, gaps: streamGaps } = reassemble(segs, clip.streamId);
  const allGaps = [...gaps, ...streamGaps];
  // Replay the stream up to `at`: the last snapshot, then every change after it.
  const mirror = createMirror();
  let url = "";
  for (const e of events) {
    if (e.timestamp > atMs) break;
    if (e.type === META && typeof e.data.href === "string") url = e.data.href;
    mirror.apply(e);
  }
  const gapBefore = allGaps.some((g) => g.kind !== "clip" && g.streamId === clip.streamId);

  return {
    sessionId: clip.sessionId,
    streamId: clip.streamId,
    clipId: clip.clipId,
    at: iso(at),
    url,
    html: mirror.html(options.compact),
    coverage: !mirror.loaded() || mirror.lost() || gapBefore ? "incomplete" : "complete",
  };
}

export function replayErrorText(error: unknown): string {
  if (error instanceof ReplayError) {
    return JSON.stringify({ error: error.code, message: error.message, streams: error.streams });
  }
  return error instanceof Error ? error.message : "unknown error";
}

export function replayHttpError(error: unknown): Response {
  if (error instanceof ReplayError) {
    const status =
      error.code === "bad_request"
        ? 400
        : error.code === "ambiguous_stream"
          ? 409
          : error.code === "too_large"
            ? 413
            : 404;
    return Response.json(
      { error: error.code, message: error.message, streams: error.streams },
      { status },
    );
  }
  return Response.json({ error: "internal" }, { status: 500 });
}
