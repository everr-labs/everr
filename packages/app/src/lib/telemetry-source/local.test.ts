import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalSqlClient } from "./local";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const ORIGIN = "http://127.0.0.1:54320";

function ndjsonResponse(body: string) {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeClient() {
  return createLocalSqlClient(ORIGIN);
}

/** The URL the client was last called with, parsed. */
function calledUrl(): URL {
  const [url] = fetchMock.mock.calls[0] ?? [];
  return new URL(String(url));
}

function calledInit(): RequestInit {
  const [, init] = fetchMock.mock.calls[0] ?? [];
  return init as RequestInit;
}

describe("createLocalSqlClient", () => {
  it("posts the SQL as the raw request body to the collector's /sql route", async () => {
    fetchMock.mockResolvedValueOnce(ndjsonResponse(""));

    await makeClient().execute("SELECT 1", {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calledUrl().origin).toBe(ORIGIN);
    expect(calledUrl().pathname).toBe("/sql");
    const init = calledInit();
    expect(init.method).toBe("POST");
    expect(init.body).toBe("SELECT 1");
  });

  it("marshals string parameters as JSON-encoded param_ query arguments", async () => {
    fetchMock.mockResolvedValueOnce(ndjsonResponse(""));

    await makeClient().execute("SELECT {from:String}", {
      from: "2026-08-01 00:00:00.000",
    });

    expect(calledUrl().searchParams.get("param_from")).toBe(
      '"2026-08-01 00:00:00.000"',
    );
  });

  it("marshals numbers bare so an integer type accepts them", async () => {
    fetchMock.mockResolvedValueOnce(ndjsonResponse(""));

    await makeClient().execute("SELECT {step:UInt32}", { step: 60 });

    expect(calledUrl().searchParams.get("param_step")).toBe("60");
  });

  it("marshals string arrays as a JSON array", async () => {
    fetchMock.mockResolvedValueOnce(ndjsonResponse(""));

    await makeClient().execute("SELECT {levels:Array(String)}", {
      levels: ["error", "warn"],
    });

    expect(calledUrl().searchParams.get("param_levels")).toBe(
      '["error","warn"]',
    );
  });

  it("omits parameters that have no value", async () => {
    fetchMock.mockResolvedValueOnce(ndjsonResponse(""));

    await makeClient().execute("SELECT 1", { missing: undefined });

    expect(calledUrl().searchParams.has("param_missing")).toBe(false);
  });

  it("parses newline-delimited rows into an array", async () => {
    fetchMock.mockResolvedValueOnce(
      ndjsonResponse('{"a":1}\n{"a":2}\n{"a":3}\n'),
    );

    const rows = await makeClient().execute("SELECT 1", {});

    expect(rows).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it("tolerates a final line with no trailing newline", async () => {
    fetchMock.mockResolvedValueOnce(ndjsonResponse('{"a":1}\n{"a":2}'));

    const rows = await makeClient().execute("SELECT 1", {});

    expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("returns an empty array for an empty result rather than throwing", async () => {
    fetchMock.mockResolvedValueOnce(ndjsonResponse(""));

    const rows = await makeClient().execute("SELECT 1", {});

    expect(rows).toEqual([]);
  });

  it("surfaces the collector's message for a rejected query", async () => {
    fetchMock.mockResolvedValueOnce(
      errorResponse(400, "param step: UInt32 expects a non-negative integer"),
    );

    await expect(makeClient().execute("SELECT 1", {})).rejects.toThrow(
      "param step: UInt32 expects a non-negative integer",
    );
  });

  it("surfaces the collector's message when the result is too large", async () => {
    fetchMock.mockResolvedValueOnce(
      errorResponse(
        413,
        "result exceeded 16 MiB; add LIMIT or narrow the WHERE",
      ),
    );

    await expect(makeClient().execute("SELECT 1", {})).rejects.toThrow(
      "result exceeded 16 MiB",
    );
  });

  it("surfaces the collector's message when it is busy", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(503, "busy"));

    await expect(makeClient().execute("SELECT 1", {})).rejects.toThrow("busy");
  });

  it("reports an unreachable collector as a connection failure", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(makeClient().execute("SELECT 1", {})).rejects.toThrow(
      /collector/i,
    );
  });

  it("falls back to the status when the error body is not the expected shape", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html>nope</html>", { status: 500 }),
    );

    await expect(makeClient().execute("SELECT 1", {})).rejects.toThrow("500");
  });
});
