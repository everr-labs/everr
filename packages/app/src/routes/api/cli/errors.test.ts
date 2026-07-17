import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data/errors/server", () => ({
  searchErrorIssues: vi.fn(),
}));

import { searchErrorIssues } from "@/data/errors/server";
import { getRouteHandler } from "./-test-utils";
import { Route } from "./errors";

const mockedSearchErrorIssues = vi.mocked(searchErrorIssues);

type GetHandler = (args: { request: Request }) => Promise<Response>;

function getHandler(): GetHandler {
  return getRouteHandler<GetHandler>(Route, "GET", "errors route");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/cli/errors", () => {
  it("forwards service and sort filters to the errors repository", async () => {
    mockedSearchErrorIssues.mockResolvedValue({ issues: [] } as never);

    const response = await getHandler()({
      request: new Request(
        "http://localhost/api/cli/errors?service=api&service=worker&sort=count&limit=25",
      ),
    });

    expect(response.status).toBe(200);
    expect(mockedSearchErrorIssues).toHaveBeenCalledTimes(1);
    const { data } = mockedSearchErrorIssues.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(data).toMatchObject({
      q: "",
      fingerprint: "",
      sort: "count",
      service: ["api", "worker"],
      limit: 25,
      attributes: [],
    });
    // The default now-7d..now range resolves to concrete ClickHouse timestamps.
    expect(data.fromTs).toMatch(/^\d{4}-\d{2}-\d{2} /);
    expect(data.toTs).toMatch(/^\d{4}-\d{2}-\d{2} /);

    const body = await response.json();
    expect(body.issues).toEqual([]);
  });

  it("rejects an unknown sort value", async () => {
    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/errors?sort=oldest"),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error:
        "Invalid query parameters for errors listing. Check service, sort, limit, and time range values.",
    });
    expect(mockedSearchErrorIssues).not.toHaveBeenCalled();
  });

  it("rejects an invalid datemath time range", async () => {
    const response = await getHandler()({
      request: new Request("http://localhost/api/cli/errors?from=yesterdayish"),
    });

    expect(response.status).toBe(400);
    expect(mockedSearchErrorIssues).not.toHaveBeenCalled();
  });
});
