import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./verify-key";

vi.mock("@/env", () => ({
  env: {
    INGEST_VERIFY_SHARED_SECRET:
      "test-shared-secret-with-at-least-32-characters",
  },
}));

vi.mock("@/db/client", () => ({
  db: {
    query: {
      apikey: {
        findFirst: vi.fn(),
      },
    },
  },
}));

vi.mock("@/lib/auth.server", () => ({
  auth: {
    api: {
      verifyApiKey: vi.fn(),
    },
  },
}));

type PostHandler = (args: { request: Request }) => Promise<Response>;

function getHandler(): PostHandler {
  const routeOptions = Route.options as unknown as {
    server?: { handlers?: { POST?: PostHandler } };
  };
  const handler = routeOptions.server?.handlers?.POST;
  if (!handler) throw new Error("Missing POST handler for verify-key.");
  return handler;
}

const SECRET = "test-shared-secret-with-at-least-32-characters";

function makeRequest(body: unknown, secret: string | null = SECRET): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (secret !== null) headers.set("x-internal-secret", secret);
  return new Request("http://localhost/api/internal/verify-key", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function mockVerify(result: unknown) {
  const { auth } = await import("@/lib/auth.server");
  vi.mocked(auth.api.verifyApiKey).mockResolvedValueOnce(result as never);
}

async function mockFindFirst(row: unknown) {
  const { db } = await import("@/db/client");
  vi.mocked(db.query.apikey.findFirst).mockResolvedValueOnce(row as never);
}

beforeEach(() => vi.clearAllMocks());

describe("/api/internal/verify-key", () => {
  it("returns 403 when shared secret is missing", async () => {
    const res = await getHandler()({
      request: makeRequest({ key: "k" }, null),
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 when shared secret is wrong", async () => {
    const res = await getHandler()({
      request: makeRequest(
        { key: "k" },
        "wrong-secret-padded-to-32-characters",
      ),
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 when body has no key", async () => {
    const res = await getHandler()({ request: makeRequest({}) });
    expect(res.status).toBe(400);
  });

  it("returns 401 when verifyApiKey rejects", async () => {
    await mockVerify({
      valid: false,
      key: null,
      error: { code: "INVALID_API_KEY" },
    });
    const res = await getHandler()({ request: makeRequest({ key: "bad" }) });
    expect(res.status).toBe(401);
  });

  it("returns 401 when key configId is not ingest", async () => {
    await mockVerify({ valid: true, key: { id: "ak_1" }, error: null });
    await mockFindFirst({
      id: "ak_1",
      configId: "cli",
      referenceId: "user_x",
      enabled: true,
      rateLimitEnabled: true,
      rateLimitMax: 10,
      rateLimitTimeWindow: 86400000,
      remaining: null,
    });
    const res = await getHandler()({ request: makeRequest({ key: "k" }) });
    expect(res.status).toBe(401);
  });

  it("returns 401 when key is disabled", async () => {
    await mockVerify({ valid: true, key: { id: "ak_2" }, error: null });
    await mockFindFirst({
      id: "ak_2",
      configId: "ingest",
      referenceId: "org_x",
      enabled: false,
      rateLimitEnabled: true,
      rateLimitMax: 10,
      rateLimitTimeWindow: 86400000,
      remaining: null,
    });
    const res = await getHandler()({ request: makeRequest({ key: "k" }) });
    expect(res.status).toBe(401);
  });

  it("returns 200 with tenantId + rateLimit for a valid ingest key", async () => {
    await mockVerify({ valid: true, key: { id: "ak_3" }, error: null });
    await mockFindFirst({
      id: "ak_3",
      configId: "ingest",
      referenceId: "org_42",
      enabled: true,
      rateLimitEnabled: true,
      rateLimitMax: 600,
      rateLimitTimeWindow: 60000,
      remaining: null,
    });
    const res = await getHandler()({ request: makeRequest({ key: "k" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tenantId: "org_42",
      keyId: "ak_3",
      rateLimit: {
        enabled: true,
        max: 600,
        windowMs: 60000,
        remaining: null,
      },
    });
  });
});
