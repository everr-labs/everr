import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./verify-key";

vi.mock("@/env", () => ({
  env: {
    INGEST_VERIFY_SHARED_SECRET:
      "test-shared-secret-with-at-least-32-characters",
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

  it("returns 401 when verified key has no referenceId", async () => {
    // Defense: a key row with a null referenceId would otherwise stamp an
    // empty tenant id onto every span sent with it.
    await mockVerify({
      valid: true,
      error: null,
      key: { id: "ak_orphan", referenceId: null },
    });
    const res = await getHandler()({ request: makeRequest({ key: "k" }) });
    expect(res.status).toBe(401);
  });

  it("returns 200 with tenantId for a valid ingest key", async () => {
    await mockVerify({
      valid: true,
      error: null,
      key: {
        id: "ak_3",
        referenceId: "org_42",
        permissions: { ingest: ["write"] },
      },
    });
    const res = await getHandler()({
      request: makeRequest({ key: "the-key" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tenantId: "org_42",
      keyId: "ak_3",
    });

    // The configId pin is the sole guarantee that a CLI/user-scoped key
    // can't be used for ingest — assert we still pass it.
    const { auth } = await import("@/lib/auth.server");
    expect(auth.api.verifyApiKey).toHaveBeenCalledWith({
      body: { key: "the-key", configId: "ingest" },
    });
  });

  it("returns 403 for a key with no permissions map", async () => {
    // A key with no capabilities grants nothing — it is rejected rather than
    // treated as fully scoped. Legacy keys are backfilled with explicit
    // capabilities by the 0006 migration, so a null map only reaches here for
    // a key that genuinely has none.
    await mockVerify({
      valid: true,
      error: null,
      key: { id: "ak_legacy", referenceId: "org_42", permissions: null },
    });
    const res = await getHandler()({
      request: makeRequest({ key: "the-key" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 when the key only has the apply scope", async () => {
    // A key minted for `everr apply` only must be rejected here, otherwise
    // a CI deploy token would be silently granted ingest access.
    await mockVerify({
      valid: true,
      error: null,
      key: {
        id: "ak_apply",
        referenceId: "org_42",
        permissions: { apply: ["*"] },
      },
    });
    const res = await getHandler()({
      request: makeRequest({ key: "the-key" }),
    });
    expect(res.status).toBe(403);
  });
});

// Handler-level wiring of the browser origin policy. The pure matrix lives in
// public-ingest-keys.test.ts; these assert the endpoint actually reads the
// request `origin`, feeds the verified key's `metadata` to that policy, and
// maps a denial to 403 after the scope check.
describe("/api/internal/verify-key browser origin policy", () => {
  const publicKey = {
    id: "ak_public",
    referenceId: "org_42",
    permissions: { ingest: ["write"] },
    metadata: { public: true, allowedOrigins: ["https://app.example.com"] },
  };
  const secretKey = {
    id: "ak_secret",
    referenceId: "org_42",
    permissions: { ingest: ["write"] },
  };

  it("public key + allowlisted origin: 200", async () => {
    await mockVerify({ valid: true, error: null, key: publicKey });
    const res = await getHandler()({
      request: makeRequest({
        key: "the-key",
        origin: "https://app.example.com",
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tenantId: "org_42",
      keyId: "ak_public",
    });
  });

  it("public key + normalizable origin (case/default port): 200", async () => {
    await mockVerify({ valid: true, error: null, key: publicKey });
    const res = await getHandler()({
      request: makeRequest({
        key: "the-key",
        origin: "HTTPS://App.Example.COM:443",
      }),
    });
    expect(res.status).toBe(200);
  });

  it("public key metadata handed back as a JSON string: still enforced", async () => {
    await mockVerify({
      valid: true,
      error: null,
      key: { ...publicKey, metadata: JSON.stringify(publicKey.metadata) },
    });
    const res = await getHandler()({
      request: makeRequest({
        key: "the-key",
        origin: "https://app.example.com",
      }),
    });
    expect(res.status).toBe(200);
  });

  it("public key + no origin (server-side use): 403", async () => {
    await mockVerify({ valid: true, error: null, key: publicKey });
    const res = await getHandler()({
      request: makeRequest({ key: "the-key" }),
    });
    expect(res.status).toBe(403);
  });

  it("public key + mismatched origin: 403", async () => {
    await mockVerify({ valid: true, error: null, key: publicKey });
    const res = await getHandler()({
      request: makeRequest({ key: "the-key", origin: "https://evil.example" }),
    });
    expect(res.status).toBe(403);
  });

  it("secret key + origin present (browser replay of a server key): 403", async () => {
    await mockVerify({ valid: true, error: null, key: secretKey });
    const res = await getHandler()({
      request: makeRequest({
        key: "the-key",
        origin: "https://app.example.com",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("secret key + no origin (unchanged server path): 200", async () => {
    await mockVerify({ valid: true, error: null, key: secretKey });
    const res = await getHandler()({
      request: makeRequest({ key: "the-key" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tenantId: "org_42",
      keyId: "ak_secret",
    });
  });

  it("non-string origin is ignored (treated as absent) for a secret key: 200", async () => {
    await mockVerify({ valid: true, error: null, key: secretKey });
    const res = await getHandler()({
      request: makeRequest({ key: "the-key", origin: 123 }),
    });
    expect(res.status).toBe(200);
  });
});
