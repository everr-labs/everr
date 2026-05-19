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
      key: { id: "ak_3", referenceId: "org_42" },
    });
    const res = await getHandler()({
      request: makeRequest({ key: "the-key" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tenantId: "org_42",
      keyId: "ak_3",
      allowedOrigins: [],
    });

    // The configId pin is the sole guarantee that a CLI/user-scoped key
    // can't be used for ingest — assert we still pass it.
    const { auth } = await import("@/lib/auth.server");
    expect(auth.api.verifyApiKey).toHaveBeenCalledWith({
      body: { key: "the-key", configId: "ingest" },
    });
  });

  it("returns allowedOrigins when metadata is an object", async () => {
    await mockVerify({
      valid: true,
      error: null,
      key: {
        id: "ak_obj",
        referenceId: "org_1",
        metadata: { allowedOrigins: ["https://app.example.com"] },
      },
    });
    const res = await getHandler()({ request: makeRequest({ key: "k" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tenantId: "org_1",
      keyId: "ak_obj",
      allowedOrigins: ["https://app.example.com"],
    });
  });

  it("returns allowedOrigins when metadata is a JSON string", async () => {
    // better-auth may hand the raw text column straight through when the
    // payload didn't round-trip via its serializer.
    await mockVerify({
      valid: true,
      error: null,
      key: {
        id: "ak_str",
        referenceId: "org_2",
        metadata: JSON.stringify({
          allowedOrigins: ["https://a.example", "https://b.example"],
        }),
      },
    });
    const res = await getHandler()({ request: makeRequest({ key: "k" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tenantId: "org_2",
      keyId: "ak_str",
      allowedOrigins: ["https://a.example", "https://b.example"],
    });
  });

  it("returns empty allowedOrigins when metadata is malformed JSON", async () => {
    await mockVerify({
      valid: true,
      error: null,
      key: {
        id: "ak_bad",
        referenceId: "org_3",
        metadata: "{not-json",
      },
    });
    const res = await getHandler()({ request: makeRequest({ key: "k" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tenantId: "org_3",
      keyId: "ak_bad",
      allowedOrigins: [],
    });
  });
});
