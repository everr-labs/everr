// The CLI's surface of the replay module (oxlint.boundaries.mts keeps the
// rest internal; the in-app player enters through options.ts). One read, for
// `everr cloud recording show`: the Segments of a recorded browser visit up to
// just after a moment, passed on unparsed. The CLI rebuilds the page from
// them, so a large or hostile Recording costs the reader, not this server.
// Everything else about the visit (clicks, requests, errors, navigations, the
// Clips) is in traces and logs, read with SQL.

import "@tanstack/react-start/server-only";

import {
  assertSessionRecordings,
  loadClips,
  ReplayError,
  segmentLines,
  select,
  windowAround,
} from "./session.ts";

export { ReplayError, replayHttpError } from "./session.ts";

/** The body format. The CLI refuses one it does not read: bump it on any change to the lines. */
const FORMAT = 1;
/** The page is read this long after --at, so what the page did in reply to the moment is on it. */
const SETTLE_MS = 750;

export type SegmentsRequest = {
  /** The Stream: `everr.recording.stream.id` on the browser record of the moment. */
  stream: string;
  at: Date;
};

const PARAMS = ["stream", "at"];
const RFC3339 =
  /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?([Zz]|[+-]\d{2}:\d{2})$/;

// Param names are the CLI flag names, so a message names the flag to change.
function single(params: URLSearchParams, name: string): string | undefined {
  const values = params.getAll(name);
  if (values.length > 1) throw new ReplayError("bad_request", `Pass --${name} once.`);
  const value = values[0]?.trim();
  if (value === undefined) return undefined;
  if (!value) throw new ReplayError("bad_request", `--${name} needs a value.`);
  return value;
}

function required(params: URLSearchParams, name: string): string {
  const value = single(params, name);
  if (value === undefined) throw new ReplayError("bad_request", `Pass --${name}.`);
  return value;
}

/** RFC 3339 with a zone; milliseconds kept. Anything else is refused: a zoneless time would shift. */
function instant(raw: string): Date {
  const m = RFC3339.exec(raw);
  const date = m
    ? new Date(`${m[1]}T${m[2]}.${(m[3] ?? "").padEnd(3, "0").slice(0, 3)}${m[4]}`)
    : undefined;
  if (!date || Number.isNaN(date.getTime())) {
    throw new ReplayError(
      "bad_request",
      "--at must be a time with a zone, like 2026-11-14T10:21:41.730Z, or epoch milliseconds.",
    );
  }
  return date;
}

/** Query params to a request. The boundary: after this, types are trusted. */
export function parseSegmentsRequest(params: URLSearchParams): SegmentsRequest {
  for (const key of params.keys()) {
    if (!PARAMS.includes(key)) {
      throw new ReplayError(
        "bad_request",
        `Unknown parameter ${JSON.stringify(key.slice(0, 40))}.`,
      );
    }
  }
  const stream = required(params, "stream");
  if (stream.length > 128) throw new ReplayError("bad_request", "--stream is too long.");
  return { stream, at: instant(required(params, "at")) };
}

export type SegmentRead = { readAt: Date; lines: AsyncIterable<string> };

/**
 * The Segments of the page of a Stream just after a moment, where recordings
 * are stored:
 *   windowAround, loadClips  the Stream's Clips within 5 minutes of --at
 *   select                   the Clip covering --at; outside_clip names the nearest
 *   segmentLines             its Segments up to SETTLE_MS after --at, at most to its end
 */
export async function readSegments(
  organizationId: string,
  request: SegmentsRequest,
): Promise<SegmentRead> {
  assertSessionRecordings();
  const atMs = request.at.getTime();
  const window = windowAround(atMs);
  const clips = await loadClips(organizationId, request.stream, window, atMs);
  const clip = select(clips, request.stream, atMs, window);
  const readAt = new Date(Math.min(atMs + SETTLE_MS, clip.end.getTime()));
  return { readAt, lines: await segmentLines(organizationId, clip, readAt) };
}

/**
 * The response body, one JSON value per line: `{"format", "read_ms"}`, the
 * Segment rows, then `{"rows": N}`. The CLI takes a body without its last
 * line as cut short.
 */
export function segmentsBody(read: SegmentRead): ReadableStream<Uint8Array<ArrayBuffer>> {
  const encoder = new TextEncoder();
  const lines = read.lines[Symbol.asyncIterator]();
  let rows = 0;
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      const header = { format: FORMAT, read_ms: read.readAt.getTime() };
      controller.enqueue(encoder.encode(`${JSON.stringify(header)}\n`));
    },
    async pull(controller) {
      try {
        const next = await lines.next();
        if (next.done) {
          controller.enqueue(encoder.encode(`${JSON.stringify({ rows })}\n`));
          controller.close();
          return;
        }
        rows += 1;
        controller.enqueue(encoder.encode(`${next.value}\n`));
      } catch (error) {
        // The status is already sent: the CLI sees a body without its end.
        console.error("recording segment read failed", error);
        controller.error(error);
      }
    },
    async cancel() {
      await lines.return?.();
    },
  });
}
