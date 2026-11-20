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

/**
 * A Clip as the reader's query returns it: the aggregate of the Segments of one
 * run. plan() filters on `streamId` and `clipId`, as the WHERE and HAVING do.
 */
type ClipRow = {
  serviceName: string;
  startMs: number;
  endMs: number;
  clipId: string;
  streamId: string;
  trigger: string;
  sessionId: string;
};

/**
 * A Segment row. `stream_id` and `at` are not selected: plan() filters on them,
 * as the WHERE does. `at` is the Segment's Timestamp in epoch ms; a row without
 * one is always inside the read. `earlier` is 1 on the body-less rows the
 * reader gets for the Segments before the Clip.
 */
type SegmentRow = {
  stream_id: string;
  at?: number;
  segment_index: number;
  Body: string;
  event_index: string;
  piece: string;
  pieces: string;
  earlier: number;
};

export function clipRow(overrides: Partial<ClipRow> = {}): ClipRow {
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
    earlier: 0,
    ...overrides,
  };
}

/** A Segment row as the JSON line ClickHouse writes for it. */
export function segLine({ stream_id: _stream, at: _at, ...row }: SegmentRow): string {
  return JSON.stringify(row);
}

async function* each(lines: string[]): AsyncGenerator<string> {
  yield* lines;
}

/**
 * Answers the mocked queries by SQL shape:
 *   GROUP BY clip_start       Clips of the `stream` param overlapping the window, one per Clip,
 *                             nearest to the `atMs` param first;
 *                             with a `clipId` param, the run of that Clip, starting in the window,
 *                             with its trigger as `openedTrigger`
 *   AS bytes                  the size of the Segments (`bytes` overrides it)
 *   FROM recordings           the Segments of the `stream` param (as JSON lines from queryLines);
 *                             a row with `at` is read only inside [fromMs, toMs], and, when the
 *                             SQL has a UNION ALL, comes as a body-less `earlier` row up to an
 *                             hour before fromMs
 */
export function plan(
  rows: { clips?: ClipRow[]; recordings?: SegmentRow[]; bytes?: number } = {},
): void {
  const recordings = (params: Record<string, unknown>, sql = "") => {
    const union = sql.includes("UNION ALL");
    const out: SegmentRow[] = [];
    for (const r of rows.recordings ?? []) {
      if (r.stream_id !== params.stream) continue;
      if (r.at === undefined || (r.at >= Number(params.fromMs) && r.at <= Number(params.toMs))) {
        out.push(r);
      } else if (union && r.at < Number(params.fromMs) && r.at >= Number(params.fromMs) - HOUR) {
        out.push({ ...r, Body: "", event_index: "", piece: "", pieces: "", earlier: 1 });
      }
    }
    return out.sort((a, b) => a.segment_index - b.segment_index);
  };
  mockedQuery.mockImplementation(async (sql: string, _org, rawParams) => {
    const params = (rawParams ?? {}) as Record<string, unknown>;
    if (isClipQuery(sql) && typeof params.clipId === "string") {
      return (rows.clips ?? [])
        .filter(
          (c) =>
            c.clipId === params.clipId &&
            c.startMs >= Number(params.fromMs) &&
            c.startMs <= Number(params.toMs),
        )
        .map(({ trigger, ...run }) => ({ ...run, openedTrigger: trigger })) as never;
    }
    if (isClipQuery(sql)) {
      const seen = new Set<string>();
      const matching = (rows.clips ?? []).filter((c) => {
        if (!c.clipId || c.streamId !== params.stream) return false;
        if (typeof params.startFromMs === "number" && c.startMs < params.startFromMs) return false;
        if (typeof params.toMs === "number" && c.startMs > params.toMs) return false;
        if (typeof params.fromMs === "number" && c.endMs < params.fromMs) return false;
        return !seen.has(c.clipId) && !!seen.add(c.clipId);
      });
      const at = Number(params.atMs);
      const gap = (c: ClipRow) => Math.max(0, c.startMs - at, at - c.endMs);
      return matching
        .sort((a, b) => gap(a) - gap(b) || b.endMs - a.endMs)
        .slice(0, typeof params.cap === "number" ? params.cap : undefined) as never;
    }
    if (/FROM\s+recordings/.test(sql) && sql.includes("AS bytes")) {
      const size = recordings(params).reduce((n, r) => n + r.Body.length, 0);
      return [{ bytes: rows.bytes ?? size }] as never;
    }
    if (/FROM\s+recordings/.test(sql)) {
      return recordings(params, sql).map(({ stream_id: _stream, at: _at, ...row }) => row) as never;
    }
    throw new Error(`unexpected query: ${sql}`);
  });
  mockedQueryLines.mockImplementation(async (sql: string, _org, rawParams) => {
    const params = (rawParams ?? {}) as Record<string, unknown>;
    if (/FROM\s+recordings/.test(sql)) return each(recordings(params, sql).map(segLine));
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

export const isClipQuery = (sql: string) => /GROUP BY[^\n]*clip_start/.test(sql);
export const isSegmentQuery = (sql: string) => !isClipQuery(sql) && /FROM\s+recordings/.test(sql);

export async function collect(lines: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const line of lines) out.push(line);
  return out;
}
