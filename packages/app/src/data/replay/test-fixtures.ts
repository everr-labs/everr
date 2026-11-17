// Fixtures for the replay tests: rows as ClickHouse returns them, and `plan()`,
// which answers the mocked `query` and `queryLines` by the shape of their SQL,
// filtering rows by the query's own params the way the WHERE would. Each test
// file mocks `#app/lib/clickhouse.ts` before importing this.

import { vi } from "vite-plus/test";
import { query, queryLines } from "#app/lib/clickhouse.ts";

const mockedQuery = vi.mocked(query);
const mockedQueryLines = vi.mocked(queryLines);

export const ORG = "org-1";
export const STREAM = "dbe6963e8f8a0df621eeb891846e5d30";
export const CLIP_ID = "8fa44e8b05e90c9b9204397b6efeb32f";
const SERVICE = "verify-sdk-web";
export const HOUR = 60 * 60 * 1000;

/** A `recording` span row. plan() filters on `streamId` and `clipId`, as the WHERE does. */
type SpanRow = {
  serviceName: string;
  startMs: number;
  endMs: number;
  clipId: string;
  streamId: string;
  trigger: string;
  sessionId: string;
};

/** A Segment row. `stream_id` is not selected: plan() filters on it, as the WHERE does. */
type SegmentRow = {
  stream_id: string;
  segment_index: number;
  Body: string;
  event_index: string;
  piece: string;
  pieces: string;
};

export function spanRow(overrides: Partial<SpanRow> = {}): SpanRow {
  const startMs = overrides.startMs ?? Date.now() - 10_000;
  return {
    serviceName: SERVICE,
    startMs,
    endMs: startMs + 5_000,
    clipId: CLIP_ID,
    streamId: STREAM,
    trigger: "error",
    sessionId: "sess-1",
    ...overrides,
  };
}

export function segRow(body: string, overrides: Partial<SegmentRow> = {}): SegmentRow {
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

/** A Segment row as the JSON line ClickHouse writes for it. */
export function segLine({ stream_id: _stream, ...row }: SegmentRow): string {
  return JSON.stringify(row);
}

async function* each(lines: string[]): AsyncGenerator<string> {
  yield* lines;
}

/**
 * Answers the mocked queries by SQL shape:
 *   SpanName = 'recording'    Clips of the `stream` param overlapping the window, one per Clip;
 *                             with a `clipId` param, the spans of that Clip starting in the window
 *   AS bytes                  the size of the Segments (`bytes` overrides it)
 *   FROM recordings           the Segments of the `stream` param (as JSON lines from queryLines)
 */
export function plan(
  rows: { clips?: SpanRow[]; recordings?: SegmentRow[]; bytes?: number } = {},
): void {
  const recordings = (params: Record<string, unknown>) =>
    (rows.recordings ?? []).filter((r) => r.stream_id === params.stream);
  mockedQuery.mockImplementation(async (sql: string, _org, rawParams) => {
    const params = (rawParams ?? {}) as Record<string, unknown>;
    if (sql.includes("SpanName = 'recording'") && typeof params.clipId === "string") {
      return (rows.clips ?? []).filter(
        (c) =>
          c.clipId === params.clipId &&
          c.startMs >= Number(params.fromMs) &&
          c.startMs <= Number(params.toMs),
      ) as never;
    }
    if (sql.includes("SpanName = 'recording'")) {
      const seen = new Set<string>();
      const matching = (rows.clips ?? []).filter((c) => {
        if (c.streamId !== params.stream) return false;
        if (typeof params.startFromMs === "number" && c.startMs < params.startFromMs) return false;
        if (typeof params.toMs === "number" && c.startMs > params.toMs) return false;
        if (typeof params.fromMs === "number" && c.endMs < params.fromMs) return false;
        return !seen.has(c.clipId) && !!seen.add(c.clipId);
      });
      return matching
        .sort((a, b) => b.startMs - a.startMs)
        .slice(0, typeof params.cap === "number" ? params.cap : undefined) as never;
    }
    if (/FROM\s+recordings/.test(sql) && sql.includes("AS bytes")) {
      const size = recordings(params).reduce((n, r) => n + r.Body.length, 0);
      return [{ bytes: rows.bytes ?? size }] as never;
    }
    if (/FROM\s+recordings/.test(sql)) {
      return recordings(params).map(({ stream_id: _stream, ...row }) => row) as never;
    }
    throw new Error(`unexpected query: ${sql}`);
  });
  mockedQueryLines.mockImplementation(async (sql: string, _org, rawParams) => {
    const params = (rawParams ?? {}) as Record<string, unknown>;
    if (/FROM\s+recordings/.test(sql)) return each(recordings(params).map(segLine));
    throw new Error(`unexpected query: ${sql}`);
  });
}

interface QueryCall {
  sql: string;
  params: Record<string, unknown>;
  settings?: Record<string, string>;
}

export function calls(match: (sql: string) => boolean = () => true): QueryCall[] {
  return [...mockedQuery.mock.calls, ...mockedQueryLines.mock.calls]
    .filter(([sql]) => match(sql))
    .map(([sql, _org, params, settings]) => ({
      sql,
      params: (params ?? {}) as Record<string, unknown>,
      settings: settings as unknown as QueryCall["settings"],
    }));
}

export const isClipQuery = (sql: string) => sql.includes("SpanName = 'recording'");
export const isSegmentQuery = (sql: string) => /FROM\s+recordings/.test(sql);

export async function collect(lines: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const line of lines) out.push(line);
  return out;
}
