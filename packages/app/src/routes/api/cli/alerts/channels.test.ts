import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createChannel,
  listChannels,
} from "@/data/alerting/delivery/repository";
import {
  CLI_TEST_ORG_ID,
  type CliRouteHandler,
  cliSessionContext,
  getRouteHandler,
} from "../-test-utils";
import { Route } from "./channels";

vi.mock("@/data/alerting/delivery/repository", () => ({
  listChannels: vi.fn(),
  createChannel: vi.fn(),
}));

const mockedList = vi.mocked(listChannels);
const mockedCreate = vi.mocked(createChannel);

type Handler = CliRouteHandler;

const context = cliSessionContext();

function post(body: unknown): Promise<Response> {
  const handler = getRouteHandler<Handler>(
    Route,
    "POST",
    "/api/cli/alerts/channels",
  );
  return handler({
    request: new Request("http://localhost/api/cli/alerts/channels", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    context,
  });
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/cli/alerts/channels", () => {
  it("returns the org's channels with secrets redacted", async () => {
    mockedList.mockResolvedValueOnce([
      {
        id: "c-1",
        tenant: CLI_TEST_ORG_ID,
        name: "oncall",
        config: { type: "slack", url: "***" },
      },
    ]);

    const handler = getRouteHandler<Handler>(Route, "GET");
    const res = await handler({
      request: new Request("http://localhost/api/cli/alerts/channels"),
      context,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        id: "c-1",
        tenant: CLI_TEST_ORG_ID,
        name: "oncall",
        config: { type: "slack", url: "***" },
      },
    ]);
    expect(mockedList).toHaveBeenCalledWith(CLI_TEST_ORG_ID);
  });
});

describe("POST /api/cli/alerts/channels", () => {
  it("creates the channel", async () => {
    mockedCreate.mockResolvedValueOnce({ id: "c-1" } as never);

    const res = await post({
      name: "oncall",
      config: { type: "slack", url: "https://hooks.slack.test/abc" },
    });

    expect(res.status).toBe(200);
    expect(mockedCreate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: CLI_TEST_ORG_ID }),
      {
        name: "oncall",
        config: { type: "slack", url: "https://hooks.slack.test/abc" },
      },
    );
  });
});
