import "@tanstack/react-start/server-only";

import { query } from "#app/lib/clickhouse.ts";

const SPAN_LOOKBACK_DAYS = 31;
const MAX_CLIPS = 20;
const MAX_SEGMENT_BYTES = 32 * 1024 * 1024;
const MAX_STEPS = 500;
const WINDOW_MAX_MS = 24 * 60 * 60 * 1000;

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
  | { kind: "conflict"; streamId: string; segmentIndex: number };

type JourneyStep =
  | { kind: "page"; at: string; streamId: string; url: string }
  | { kind: "click"; at: string; streamId: string; target: string | null }
  | { kind: "input"; at: string; streamId: string; target: string | null }
  | { kind: "pause" | "resume"; at: string; streamId: string };

export type SessionJourney = {
  sessionId: string;
  windowStart: string;
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
  html: string;
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

function asTrigger(raw: string): Trigger {
  if (raw === "error" || raw === "network" || raw === "manual") return raw;
  throw new ReplayError("bad_request", `unknown recording trigger: ${raw}`);
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
  start: string;
  end: string;
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
): Promise<ClipWindow[]> {
  const rows = await query<SpanRow>(
    `
SELECT
  ServiceName AS serviceName,
  toString(Timestamp) AS start,
  toString(Timestamp + toIntervalNanosecond(Duration)) AS end,
  toString(SpanAttributes.\`everr.recording.clip.id\`) AS clipId,
  toString(SpanAttributes.\`everr.recording.stream.id\`) AS streamId,
  toString(SpanAttributes.\`everr.recording.trigger\`) AS trigger,
  toString(SpanAttributes.\`everr.recording.clip.truncated\`) AS truncated,
  toString(SpanAttributes.\`session.id\`) AS sessionId
FROM traces
WHERE SpanName = 'recording'
  AND toString(SpanAttributes.\`session.id\`) = {sessionId:String}
  AND Timestamp >= {from:DateTime64(3)}
  AND Timestamp < {to:DateTime64(3)}
ORDER BY Timestamp DESC
LIMIT {cap:UInt16}
`,
    organizationId,
    { sessionId, from, to, cap: MAX_CLIPS },
  );

  return rows.map((r) => {
    if (!r.clipId || !r.streamId || !r.serviceName) {
      throw new ReplayError("bad_request", "recording span missing clip, stream, or service");
    }
    return {
      clipId: r.clipId,
      streamId: r.streamId,
      sessionId: r.sessionId || sessionId,
      serviceName: r.serviceName,
      start: new Date(r.start),
      end: new Date(r.end),
      trigger: asTrigger(r.trigger),
      bufferTruncated: r.truncated === "true",
    };
  });
}

async function loadClipById(
  organizationId: string,
  clipId: string,
  at: Date,
): Promise<ClipWindow | undefined> {
  const lookbackMs = 60 * 60 * 1000;
  const rows = await query<SpanRow>(
    `
SELECT
  ServiceName AS serviceName,
  toString(Timestamp) AS start,
  toString(Timestamp + toIntervalNanosecond(Duration)) AS end,
  toString(SpanAttributes.\`everr.recording.clip.id\`) AS clipId,
  toString(SpanAttributes.\`everr.recording.stream.id\`) AS streamId,
  toString(SpanAttributes.\`everr.recording.trigger\`) AS trigger,
  toString(SpanAttributes.\`everr.recording.clip.truncated\`) AS truncated,
  toString(SpanAttributes.\`session.id\`) AS sessionId
FROM traces
WHERE SpanName = 'recording'
  AND toString(SpanAttributes.\`everr.recording.clip.id\`) = {clipId:String}
  AND Timestamp >= {from:DateTime64(3)}
  AND Timestamp <= {to:DateTime64(3)}
ORDER BY Timestamp ASC
LIMIT 2
`,
    organizationId,
    {
      clipId,
      from: new Date(at.getTime() - lookbackMs),
      to: new Date(at.getTime() + lookbackMs),
    },
  );
  if (rows.length !== 1) return undefined;
  const r = rows[0];
  if (!r?.clipId || !r.streamId || !r.serviceName || !r.sessionId) return undefined;
  return {
    clipId: r.clipId,
    streamId: r.streamId,
    sessionId: r.sessionId,
    serviceName: r.serviceName,
    start: new Date(r.start),
    end: new Date(r.end),
    trigger: asTrigger(r.trigger),
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

async function loadSegments(
  organizationId: string,
  windows: ClipWindow[],
): Promise<{ byStream: Map<string, StoredSegment[]>; gaps: Gap[] }> {
  if (windows.length === 0) return { byStream: new Map(), gaps: [] };

  const from = new Date(Math.min(...windows.map((w) => w.start.getTime())));
  const to = new Date(Math.max(...windows.map((w) => w.end.getTime())));
  const services = [...new Set(windows.map((w) => w.serviceName))];
  const streams = [...new Set(windows.map((w) => w.streamId))];

  const rows = await query<SegmentRow>(
    `
SELECT
  stream_id,
  segment_index,
  Body,
  toString(LogAttributes.\`everr.recording.event.index\`) AS event_index,
  toString(LogAttributes.\`everr.recording.event.piece\`) AS piece,
  toString(LogAttributes.\`everr.recording.event.pieces\`) AS pieces
FROM recordings
WHERE ServiceName IN {services:Array(String)}
  AND stream_id IN {streams:Array(String)}
  AND Timestamp >= {from:DateTime64(9)}
  AND Timestamp <= {to:DateTime64(9)}
ORDER BY stream_id, segment_index
`,
    organizationId,
    { services, streams, from, to },
  );

  let bytes = 0;
  const gaps: Gap[] = [];
  const byStream = new Map<string, StoredSegment[]>();
  const seen = new Map<string, string>();

  for (const row of rows) {
    bytes += row.Body.length;
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

  // Drop segments whose timestamp-as-index placement is outside every window for that stream.
  // We already filtered by the union range in SQL; event-level clip happens after reassemble.
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

function projectSteps(
  streamId: string,
  events: RrwebEvent[],
  until: Date,
  cap: number,
): { steps: JourneyStep[]; truncated: boolean } {
  const steps: JourneyStep[] = [];
  const untilMs = until.getTime();
  for (const e of events) {
    if (e.timestamp > untilMs) break;
    if (steps.length >= cap) return { steps, truncated: true };
    const at = new Date(e.timestamp).toISOString();
    if (e.type === 4) {
      const href = typeof e.data.href === "string" ? e.data.href : "";
      steps.push({ kind: "page", at, streamId, url: href });
      continue;
    }
    if (e.type === 5) {
      const tag = typeof e.data.tag === "string" ? e.data.tag : "";
      if (tag === "everr.recording.pause") steps.push({ kind: "pause", at, streamId });
      if (tag === "everr.recording.resume") steps.push({ kind: "resume", at, streamId });
      continue;
    }
    if (e.type === 3 && e.data.source === 2) {
      const mouseType = e.data.type;
      if (mouseType === 2 || mouseType === 4) {
        steps.push({ kind: "click", at, streamId, target: null });
      }
      continue;
    }
    if (e.type === 3 && e.data.source === 5) {
      steps.push({ kind: "input", at, streamId, target: null });
    }
  }
  return { steps, truncated: false };
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

type SnapNode = {
  type: number;
  tagName?: string;
  attributes?: Record<string, string>;
  textContent?: string;
  childNodes?: SnapNode[];
  id?: number;
};

function isSnapNode(value: unknown): value is SnapNode {
  if (!value || typeof value !== "object") return false;
  return "type" in value && typeof value.type === "number";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function serializeNode(node: SnapNode): string {
  // rrweb NodeType: Document=0, DocumentType=1, Element=2, Text=3, CDATA=4, Comment=5
  if (node.type === 3) return escapeHtml(node.textContent ?? "");
  if (node.type === 5) return `<!--${escapeHtml(node.textContent ?? "")}-->`;
  if (node.type === 1) {
    const name = node.tagName ?? "html";
    return `<!DOCTYPE ${name}>`;
  }
  if (node.type === 0) {
    return (node.childNodes ?? []).map(serializeNode).join("");
  }
  if (node.type === 2) {
    const tag = (node.tagName ?? "div").toLowerCase();
    const attrs = Object.entries(node.attributes ?? {})
      .map(([k, v]) => ` ${k}="${escapeHtml(String(v))}"`)
      .join("");
    const voidTags = new Set([
      "area",
      "base",
      "br",
      "col",
      "embed",
      "hr",
      "img",
      "input",
      "link",
      "meta",
      "param",
      "source",
      "track",
      "wbr",
    ]);
    if (voidTags.has(tag)) return `<${tag}${attrs}>`;
    const kids = (node.childNodes ?? []).map(serializeNode).join("");
    return `<${tag}${attrs}>${kids}</${tag}>`;
  }
  return "";
}

function htmlFromEvents(
  events: RrwebEvent[],
  until: Date,
): { url: string; html: string; coverage: "complete" | "incomplete" } {
  const untilMs = until.getTime();
  let url = "";
  let snapshotNode: SnapNode | undefined;
  let snapshotAt = -1;
  let sawLaterMutation = false;

  for (const e of events) {
    if (e.timestamp > untilMs) break;
    if (e.type === 4 && typeof e.data.href === "string") {
      url = e.data.href;
    }
    if (e.type === 2 && isSnapNode(e.data.node)) {
      snapshotNode = e.data.node;
      snapshotAt = e.timestamp;
      sawLaterMutation = false;
    }
    if (e.type === 3 && e.timestamp > snapshotAt && snapshotAt >= 0) {
      sawLaterMutation = true;
    }
  }

  if (!snapshotNode) {
    return { url, html: "", coverage: "incomplete" };
  }
  const html = serializeNode(snapshotNode);
  return {
    url,
    html:
      html.startsWith("<!DOCTYPE") || html.startsWith("<html") ? html : `<!doctype html>${html}`,
    coverage: sawLaterMutation ? "incomplete" : "complete",
  };
}

function emptyJourney(sessionId: string, windowStart: Date): SessionJourney {
  return {
    sessionId,
    windowStart: iso(windowStart),
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

export async function sessionJourney(
  organizationId: string,
  sessionId: string,
  range?: { from?: string | Date; to?: string | Date },
): Promise<SessionJourney> {
  if (!organizationId || !sessionId) {
    throw new ReplayError("bad_request", "sessionId is required");
  }
  const to = asDate(range?.to, "to") ?? new Date();
  const from =
    asDate(range?.from, "from") ??
    new Date(to.getTime() - SPAN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  if (!(from < to)) {
    throw new ReplayError("bad_request", "from must be before to");
  }
  if ((range?.from || range?.to) && to.getTime() - from.getTime() > WINDOW_MAX_MS) {
    throw new ReplayError("bad_request", "from/to window must be at most 24 hours");
  }

  const clips = await loadClips(organizationId, sessionId, from, to);
  if (clips.length === 0) return emptyJourney(sessionId, from);

  const overlapping = clips.filter((c) => c.end >= from && c.start <= to);
  const { byStream, gaps: loadGaps } = await loadSegments(organizationId, overlapping);
  const steps: JourneyStep[] = [];
  const gaps = [...loadGaps];
  let truncated = overlapping.length >= MAX_CLIPS;

  for (const [streamId, segs] of byStream) {
    const streamClips = overlapping.filter((c) => c.streamId === streamId);
    const until = new Date(Math.max(...streamClips.map((c) => c.end.getTime())));
    const { events, gaps: streamGaps } = reassemble(segs, streamId);
    gaps.push(...streamGaps);
    const clipped = events.filter((e) => {
      return streamClips.some(
        (c) => e.timestamp >= c.start.getTime() && e.timestamp <= c.end.getTime(),
      );
    });
    const projected = projectSteps(streamId, clipped, until, MAX_STEPS - steps.length);
    steps.push(...projected.steps);
    if (projected.truncated) truncated = true;
  }

  steps.sort((a, b) => a.at.localeCompare(b.at));
  const capped = steps.slice(0, MAX_STEPS);
  if (steps.length > MAX_STEPS) truncated = true;

  const clipsByTrigger: Record<Trigger, number> = { error: 0, network: 0, manual: 0 };
  for (const c of overlapping) clipsByTrigger[c.trigger]++;

  return {
    sessionId,
    windowStart: iso(from),
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
    steps: capped,
    gaps,
    facts: {
      pages: capped.filter((s) => s.kind === "page").length,
      clicks: capped.filter((s) => s.kind === "click").length,
      inputs: capped.filter((s) => s.kind === "input").length,
      clipsByTrigger,
      gapCount: gaps.length,
    },
  };
}

export async function pageAt(
  organizationId: string,
  request: { sessionId?: string; clipId?: string; at: string; streamId?: string },
): Promise<PageSnapshot> {
  if (!organizationId) throw new ReplayError("bad_request", "missing organization");
  if (!request.at) throw new ReplayError("bad_request", "at is required");
  const at = parseInstant(request.at);

  let clip: ClipWindow | undefined;
  if (request.clipId) {
    clip = await loadClipById(organizationId, request.clipId, at);
    if (!clip) throw new ReplayError("outside_clip", "no recording clip found near at");
  } else {
    if (!request.sessionId) {
      throw new ReplayError("bad_request", "sessionId or clipId is required");
    }
    const from = new Date(at.getTime() - SPAN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const to = new Date(at.getTime() + 60 * 60 * 1000);
    const clips = (await loadClips(organizationId, request.sessionId, from, to)).filter(
      (c) => c.start <= at && c.end >= at,
    );
    const byStream = request.streamId
      ? clips.filter((c) => c.streamId === request.streamId)
      : clips;
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

  const { byStream, gaps } = await loadSegments(organizationId, [clip]);
  const segs = byStream.get(clip.streamId) ?? [];
  const { events, gaps: streamGaps } = reassemble(segs, clip.streamId);
  const allGaps = [...gaps, ...streamGaps];
  const inRange = events.filter((e) => e.timestamp <= clip.end.getTime());
  const built = htmlFromEvents(inRange, at);
  const gapBefore = allGaps.some((g) => g.streamId === clip.streamId);

  return {
    sessionId: clip.sessionId,
    streamId: clip.streamId,
    clipId: clip.clipId,
    at: iso(at),
    url: built.url,
    html: built.html,
    coverage: built.coverage === "incomplete" || gapBefore ? "incomplete" : "complete",
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
