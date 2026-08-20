import { beforeEach, describe, expect, it, vi } from "vitest";
import { expireSilence } from "@/data/alerting/silences/repository";
import {
  CLI_TEST_ORG_ID,
  type CliRouteHandler,
  cliSessionContext,
  getRouteHandler,
} from "../../../-test-utils";
import { Route } from "./expire";

vi.mock("@/data/alerting/silences/repository", () => ({
  expireSilence: vi.fn(),
}));

const mockedExpire = vi.mocked(expireSilence);

type Handler = CliRouteHandler<{ id: string }>;

function expire(id: string): Promise<Response> {
  const handler = getRouteHandler<Handler>(
    Route,
    "POST",
    "/api/cli/alerts/silences/$id/expire",
  );
  return handler({ params: { id }, context: cliSessionContext() });
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/cli/alerts/silences/$id/expire", () => {
  it("closes the silence's window", async () => {
    mockedExpire.mockResolvedValueOnce({ expired: true });

    const res = await expire("s-1");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ expired: true });
    expect(mockedExpire).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: CLI_TEST_ORG_ID }),
      "s-1",
    );
  });

  it("reports an already-closed silence rather than failing", async () => {
    mockedExpire.mockResolvedValueOnce({ expired: false });

    const res = await expire("s-1");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ expired: false });
  });
});
