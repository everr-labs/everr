import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type * as Replay from "#app/data/replay/index.ts";

vi.mock("#app/lib/clickhouse.ts", () => ({
  query: vi.fn(),
  queryLines: vi.fn(),
  querySqlApi: vi.fn(),
  runSqlApiQuery: vi.fn(),
}));

const deployment = vi.hoisted(() => ({ sessionRecordings: false }));
vi.mock("@composition/client", () => ({ productClient: deployment }));

const actual = vi.hoisted(() => ({
  readSegments: undefined as typeof Replay.readSegments | undefined,
}));
vi.mock("#app/data/replay/index.ts", async (importActual) => {
  const replay = await importActual<typeof Replay>();
  actual.readSegments = replay.readSegments;
  return { ...replay, readSegments: vi.fn() };
});

import { ReplayError, readSegments } from "#app/data/replay/index.ts";
import { query } from "#app/lib/clickhouse.ts";
import { cliSessionContext, getRouteHandler } from "../-test-utils";
import { Route } from "./segments";

const mockedReadSegments = vi.mocked(readSegments);

type GetHandler = (args: {
  request: Request;
  context: ReturnType<typeof cliSessionContext>;
}) => Promise<Response>;

function callSegments(query: string, headers: Record<string, string> = {}) {
  return getRouteHandler<GetHandler>(
    Route,
    "GET",
    "segments route",
  )({
    request: new Request(`http://localhost/api/cli/recordings/segments?${query}`, { headers }),
    context: cliSessionContext(),
  });
}

async function* rows(): AsyncGenerator<string> {
  yield '{"segment_index":0,"Body":"[]","event_index":"","piece":"","pieces":""}';
}

const READ_AT = new Date("2026-11-14T10:21:42.480Z");
const BODY = `{"format":1,"read_ms":${READ_AT.getTime()}}\n{"segment_index":0,"Body":"[]","event_index":"","piece":"","pieces":""}\n{"rows":1}\n`;

beforeEach(() => {
  vi.clearAllMocks();
  mockedReadSegments.mockImplementation(async () => ({ readAt: READ_AT, lines: rows() }));
});

describe("/api/cli/recordings/segments", () => {
  it("returns the Segments as uncached JSON lines for the session's organization", async () => {
    const response = await callSegments("stream=9c41e2f0&at=2026-11-14T10:21:41.730Z");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(await response.text()).toBe(BODY);
    expect(mockedReadSegments).toHaveBeenCalledWith("org-42", {
      stream: "9c41e2f0",
      at: new Date("2026-11-14T10:21:41.730Z"),
    });
  });

  it("gzips the lines when the client accepts it", async () => {
    const response = await callSegments("stream=9c41e2f0&at=2026-11-14T10:21:41.730Z", {
      "accept-encoding": "gzip",
    });

    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("vary")).toBe("accept-encoding");
    const plain = response.body?.pipeThrough(new DecompressionStream("gzip"));
    expect(await new Response(plain).text()).toBe(BODY);
  });

  it("refuses bad parameters with 400 before reading anything", async () => {
    const response = await callSegments("stream=a");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "bad_request", message: "Pass --at." });
    expect(mockedReadSegments).not.toHaveBeenCalled();
  });

  it.each([
    ["not_found", 404],
    ["outside_clip", 404],
    ["too_large", 413],
  ] as const)("maps %s to %i with its message", async (code, status) => {
    mockedReadSegments.mockRejectedValue(new ReplayError(code, "No Clip covers that moment."));

    const response = await callSegments("stream=8fa44e8b&at=2026-11-14T10:21:41.730Z");

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code, message: "No Clip covers that moment." });
  });

  it("answers 404 with the reason where recordings are not stored, before any query", async () => {
    mockedReadSegments.mockImplementation(
      async (...args) => actual.readSegments?.(...args) as never,
    );

    const response = await callSegments("stream=8fa44e8b&at=2026-11-14T10:21:41.730Z");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "unavailable",
      message: "Session recordings are not available on this deployment",
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("hides an unexpected error behind a 500", async () => {
    mockedReadSegments.mockRejectedValue(new Error("ClickHouse said: secret detail"));

    const response = await callSegments("stream=8fa44e8b&at=2026-11-14T10:21:41.730Z");

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('{"error":"internal"}');
  });
});
