import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: { BETTER_AUTH_URL: "http://localhost:5173" },
}));
vi.mock("@/lib/auth.server", () => ({ auth: { api: {} } }));

import { auth } from "@/lib/auth.server";
import { selectOrgAndContinue, submitConsent } from "./mcp-oauth";

const api = auth.api as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe("mcp-oauth server helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.setActiveOrganization = vi.fn().mockResolvedValue({});
    api.oauth2Continue = vi.fn().mockResolvedValue({ url: "/mcp/consent?x=1" });
    api.oauth2Consent = vi.fn().mockResolvedValue({ url: "https://cb?code=1" });
  });

  it("set-active + continue use a trusted origin, not the webview's null", async () => {
    const incoming = new Headers({ cookie: "session=abc", origin: "null" });
    const res = await selectOrgAndContinue(incoming, {
      organizationId: "org_1",
      oauth_query: "client_id=c&sig=s",
    });

    expect(res).toEqual({ url: "/mcp/consent?x=1" });
    const headers = api.setActiveOrganization.mock.calls[0][0].headers as Headers;
    expect(headers.get("origin")).toBe("http://localhost:5173");
    expect(headers.get("cookie")).toBe("session=abc");
    expect(api.oauth2Continue.mock.calls[0][0].body).toMatchObject({
      postLogin: true,
      oauth_query: "client_id=c&sig=s",
    });
  });

  it("consent forwards accept + full oauth_query with a trusted origin", async () => {
    const incoming = new Headers({ cookie: "session=abc", origin: "null" });
    const res = await submitConsent(incoming, {
      accept: true,
      scope: "observability:read",
      oauth_query: "client_id=c&sig=s",
    });

    expect(res).toEqual({ url: "https://cb?code=1" });
    const arg = api.oauth2Consent.mock.calls[0][0];
    expect((arg.headers as Headers).get("origin")).toBe("http://localhost:5173");
    expect(arg.body).toMatchObject({
      accept: true,
      oauth_query: "client_id=c&sig=s",
    });
  });
});
