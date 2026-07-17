import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/errors/server", () => ({
  getErrorIssue: vi.fn(),
}));

import { getErrorIssue } from "@/data/errors/server";
import { getRouteHandler } from "../-test-utils";
import { Route } from "./$fingerprint";

const mockedGetErrorIssue = vi.mocked(getErrorIssue);

type GetHandler = (args: {
  params: { fingerprint?: string };
  request: Request;
}) => Promise<Response>;

function getHandler(): GetHandler {
  return getRouteHandler<GetHandler>(Route, "GET", "error detail route");
}

const summary = {
  fingerprint: "fp-1",
  exceptionType: "TypeError",
  exceptionMessage: "boom",
  body: "TypeError: boom",
  latestServiceName: "api",
  services: ["api"],
  occurrenceCount: 3,
  traceCount: 2,
  firstSeen: "2026-07-01 10:00:00",
  lastSeen: "2026-07-09 14:03:11",
  latestTraceId: "trace-1",
  latestSpanId: "span-1",
  latestTimestamp: "2026-07-09 14:03:11",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/cli/errors/$fingerprint", () => {
  it("returns the issue detail", async () => {
    const latest = { fingerprint: "fp-1", exceptionStacktrace: "at boom" };
    const detail = { summary, latest, occurrences: [latest] };
    mockedGetErrorIssue.mockResolvedValue(detail as never);

    const response = await getHandler()({
      params: { fingerprint: "fp-1" },
      request: new Request(
        "http://localhost/api/cli/errors/fp-1?occurrenceLimit=10",
      ),
    });

    expect(response.status).toBe(200);
    const { data } = mockedGetErrorIssue.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(data).toMatchObject({
      fingerprint: "fp-1",
      service: [],
      occurrenceLimit: 10,
    });

    const body = await response.json();
    expect(body.summary).toEqual(summary);
    expect(body.occurrences).toEqual([latest]);
  });

  it("maps a missing issue to a 404", async () => {
    mockedGetErrorIssue.mockRejectedValue(new Error("Error issue not found"));

    const response = await getHandler()({
      params: { fingerprint: "fp-missing" },
      request: new Request("http://localhost/api/cli/errors/fp-missing"),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error:
        "No Error with Fingerprint fp-missing in the now-7d..now time range.",
    });
  });

  it("rejects an invalid occurrence limit", async () => {
    const response = await getHandler()({
      params: { fingerprint: "fp-1" },
      request: new Request(
        "http://localhost/api/cli/errors/fp-1?occurrenceLimit=0",
      ),
    });

    expect(response.status).toBe(400);
    expect(mockedGetErrorIssue).not.toHaveBeenCalled();
  });
});
