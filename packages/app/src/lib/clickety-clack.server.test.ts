import { afterEach, describe, expect, it, vi } from "vitest";
import { ccRequest } from "./clickety-clack.server";

const mockEnv = vi.hoisted(
  (): { CLICKETY_CLACK_BASE_URL: string; CLICKETY_CLACK_API_KEY?: string } => ({
    CLICKETY_CLACK_BASE_URL: "http://cc.test",
  }),
);

vi.mock("@/env", () => ({ env: mockEnv }));

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete mockEnv.CLICKETY_CLACK_API_KEY;
});

describe("ccRequest", () => {
  it("sends X-CC-Tenant and returns parsed JSON on 200", async () => {
    const fetchMock = mockFetch(200, { ok: 1 });
    vi.stubGlobal("fetch", fetchMock);

    const out = await ccRequest("org_abc", "GET", "/v1/rules");

    expect(out).toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://cc.test/v1/rules");
    expect((init.headers as Record<string, string>)["X-CC-Tenant"]).toBe(
      "org_abc",
    );
  });

  it("sends a bearer Authorization header when the API key is configured", async () => {
    mockEnv.CLICKETY_CLACK_API_KEY = "cc-key-1";
    const fetchMock = mockFetch(200, { ok: 1 });
    vi.stubGlobal("fetch", fetchMock);

    await ccRequest("org_abc", "GET", "/v1/rules");

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer cc-key-1",
    );
  });

  it("omits the Authorization header when no API key is configured", async () => {
    const fetchMock = mockFetch(200, { ok: 1 });
    vi.stubGlobal("fetch", fetchMock);

    await ccRequest("org_abc", "GET", "/v1/rules");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers as Record<string, string>).not.toHaveProperty(
      "authorization",
    );
  });

  it("maps a problem+json error body to CcApiError", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(422, {
        title: "validation_failed",
        status: 422,
        detail: "interval_secs must be > 0",
        code: "validation_failed",
      }),
    );

    await expect(
      ccRequest("org_abc", "POST", "/v1/rules", {}),
    ).rejects.toMatchObject({
      name: "CcApiError",
      status: 422,
      code: "validation_failed",
      message: "interval_secs must be > 0",
    });
  });

  it("falls back to statusText when body is not problem+json", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("bad gateway", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ccRequest("org_abc", "GET", "/v1/alerts"),
    ).rejects.toMatchObject({
      name: "CcApiError",
      status: 502,
      code: "unknown",
    });
  });
});
