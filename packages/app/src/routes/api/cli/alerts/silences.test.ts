import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSilence,
  listSilences,
} from "@/data/alerting/silences/repository";
import {
  CLI_TEST_ORG_ID,
  type CliRouteHandler,
  cliSessionContext,
  getRouteHandler,
} from "../-test-utils";
import { Route } from "./silences";

vi.mock("@/data/alerting/silences/repository", () => ({
  listSilences: vi.fn(),
  createSilence: vi.fn(),
}));

const mockedList = vi.mocked(listSilences);
const mockedCreate = vi.mocked(createSilence);

type Handler = CliRouteHandler;

const context = cliSessionContext();

function post(body: unknown): Promise<Response> {
  const handler = getRouteHandler<Handler>(
    Route,
    "POST",
    "/api/cli/alerts/silences",
  );
  return handler({
    request: new Request("http://localhost/api/cli/alerts/silences", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    context,
  });
}

const validInput = {
  matchers: [{ label: "service", op: "eq", value: "api" }],
  starts_at: "2026-08-20T09:00:00.000Z",
  ends_at: "2026-08-20T11:00:00.000Z",
  comment: "deploy window",
};

beforeEach(() => vi.clearAllMocks());

describe("GET /api/cli/alerts/silences", () => {
  async function get(query = ""): Promise<Response> {
    const handler = getRouteHandler<Handler>(Route, "GET");
    return handler({
      request: new Request(`http://localhost/api/cli/alerts/silences${query}`),
      context,
    });
  }

  it("bounds a request that named no page", async () => {
    mockedList.mockResolvedValueOnce([{ id: "s-1" }] as never);

    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "s-1" }]);
    expect(mockedList).toHaveBeenCalledWith(CLI_TEST_ORG_ID, {
      limit: 20,
      offset: 0,
    });
  });

  it("passes the page it was given through to the query", async () => {
    mockedList.mockResolvedValueOnce([] as never);

    await get("?limit=21&offset=20");

    expect(mockedList).toHaveBeenCalledWith(CLI_TEST_ORG_ID, {
      limit: 21,
      offset: 20,
    });
  });

  it("hands the window over as instants, not as text", async () => {
    mockedList.mockResolvedValueOnce([] as never);

    await get("?from=2026-08-20T08:00:00.000Z&to=2026-08-20T10:00:00.000Z");

    expect(mockedList).toHaveBeenCalledWith(CLI_TEST_ORG_ID, {
      limit: 20,
      offset: 0,
      from: new Date("2026-08-20T08:00:00.000Z"),
      to: new Date("2026-08-20T10:00:00.000Z"),
    });
  });

  it("refuses a bound that is not a timestamp", async () => {
    const res = await get("?from=now-1d");

    expect(res.status).toBe(422);
    expect(mockedList).not.toHaveBeenCalled();
  });

  it("refuses a page size the query would not bound", async () => {
    const res = await get("?limit=5000");

    expect(res.status).toBe(422);
    expect(mockedList).not.toHaveBeenCalled();
  });
});

describe("POST /api/cli/alerts/silences", () => {
  it("creates the silence attributed to the session's user", async () => {
    mockedCreate.mockResolvedValueOnce({ id: "s-1" } as never);

    const res = await post(validInput);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "s-1" });
    expect(mockedCreate).toHaveBeenCalledWith(
      {
        organizationId: CLI_TEST_ORG_ID,
        actor: { kind: "user", id: "user-1", display: "Ada" },
      },
      expect.objectContaining({ comment: "deploy window" }),
    );
  });

  it("hands the body to the repository, which owns the schema", async () => {
    mockedCreate.mockResolvedValueOnce({ id: "s-1" } as never);

    await post(validInput);

    expect(mockedCreate.mock.calls[0]?.[1]).toEqual(validInput);
  });
});
