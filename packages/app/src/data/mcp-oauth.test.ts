import { getRequest, getRequestHeaders } from "@tanstack/react-start/server";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { auth } from "@/lib/auth.server";
import { selectMcpOrganization, submitMcpConsent } from "./mcp-oauth";

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: vi.fn(
    () => new Headers({ cookie: "session=test", origin: "null" }),
  ),
  getRequest: vi.fn(
    () =>
      new Request("http://localhost:5173/_serverFn/test", {
        method: "POST",
        headers: { cookie: "session=test", origin: "null" },
      }),
  ),
}));

const authApi = auth.api as unknown as Record<string, Mock>;
const setActiveOrganization = auth.api.setActiveOrganization as unknown as Mock;

describe("MCP OAuth server functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authApi.oauth2Continue = vi.fn().mockResolvedValue({
      url: "http://127.0.0.1:6274/callback?code=auth_code",
    });
    authApi.oauth2Consent = vi.fn().mockResolvedValue({
      url: "http://127.0.0.1:6274/callback?code=auth_code",
    });
  });

  it("sets the active organization and resumes OAuth server-side", async () => {
    const result = await selectMcpOrganization({
      data: {
        organizationId: "org_123",
        oauth_query: "client_id=client_123&sig=signed",
      },
    });

    expect(setActiveOrganization).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: { organizationId: "org_123" },
    });
    expect(authApi.oauth2Continue).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      request: expect.any(Request),
      asResponse: false,
      body: {
        postLogin: true,
        oauth_query: "client_id=client_123&sig=signed",
      },
    });
    expect(result).toEqual({
      url: "http://127.0.0.1:6274/callback?code=auth_code",
    });
    expect(getRequestHeaders).toHaveBeenCalled();
    expect(getRequest).toHaveBeenCalled();
  });

  it("submits consent server-side", async () => {
    const result = await submitMcpConsent({
      data: {
        accept: true,
        scope: "openid observability:read",
        oauth_query: "client_id=client_123&sig=signed",
      },
    });

    expect(authApi.oauth2Consent).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      request: expect.any(Request),
      asResponse: false,
      body: {
        accept: true,
        scope: "openid observability:read",
        oauth_query: "client_id=client_123&sig=signed",
      },
    });
    expect(result).toEqual({
      url: "http://127.0.0.1:6274/callback?code=auth_code",
    });
  });
});
