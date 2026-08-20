import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteChannel,
  updateChannel,
} from "@/data/alerting/delivery/repository";
import {
  CLI_TEST_ORG_ID,
  type CliRouteHandler,
  cliSessionContext,
  getRouteHandler,
} from "../../-test-utils";
import { Route } from "./$name";

vi.mock("@/data/alerting/delivery/repository", () => ({
  updateChannel: vi.fn(),
  deleteChannel: vi.fn(),
}));

const mockedUpdate = vi.mocked(updateChannel);
const mockedDelete = vi.mocked(deleteChannel);

type Handler = CliRouteHandler<{ name: string }>;

const context = cliSessionContext();

function patch(name: string, body: unknown): Promise<Response> {
  const handler = getRouteHandler<Handler>(
    Route,
    "PATCH",
    "/api/cli/alerts/channels/$name",
  );
  return handler({
    params: { name },
    request: new Request(`http://localhost/api/cli/alerts/channels/${name}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    context,
  });
}

function remove(name: string): Promise<Response> {
  const handler = getRouteHandler<Handler>(Route, "DELETE");
  return handler({
    params: { name },
    request: new Request(`http://localhost/api/cli/alerts/channels/${name}`, {
      method: "DELETE",
    }),
    context,
  });
}

beforeEach(() => vi.clearAllMocks());

describe("PATCH /api/cli/alerts/channels/$name", () => {
  it("updates the channel named in the path", async () => {
    mockedUpdate.mockResolvedValueOnce({ id: "c-1" } as never);

    const res = await patch("oncall", {
      config: { type: "slack", url: "https://hooks.slack.test/new" },
    });

    expect(res.status).toBe(200);
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: CLI_TEST_ORG_ID }),
      "oncall",
      { config: { type: "slack", url: "https://hooks.slack.test/new" } },
    );
  });

  it("passes a redacted secret through so the stored one is kept", async () => {
    mockedUpdate.mockResolvedValueOnce({ id: "c-1" } as never);

    await patch("oncall", {
      name: "primary-oncall",
      config: { type: "slack", url: "***" },
    });

    expect(mockedUpdate.mock.calls[0]?.[2]).toEqual({
      name: "primary-oncall",
      config: { type: "slack", url: "***" },
    });
  });
});

describe("DELETE /api/cli/alerts/channels/$name", () => {
  it("deletes the channel named in the path", async () => {
    mockedDelete.mockResolvedValueOnce({ deleted: true });

    const res = await remove("oncall");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(mockedDelete).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: CLI_TEST_ORG_ID }),
      "oncall",
    );
  });
});
