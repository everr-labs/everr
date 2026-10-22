// @vitest-environment node
import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { organization } from "better-auth/plugins";
import { beforeEach, describe, expect, it, type Mock, vi } from "vite-plus/test";
import { auth } from "#app/identity/server.ts";
import {
  ApiKeyCreateInputSchema,
  createApiKey,
  listApiKeys,
  permissionsForScopes,
  type ApiKey,
} from "./api-keys";

const request = vi.hoisted(() => ({ headers: {} as HeadersInit }));
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => request.headers,
}));

vi.mock("#app/identity/server.ts", () => ({
  auth: { api: { createApiKey: vi.fn(), listApiKeys: vi.fn() } },
}));

const createApiKeyMock = auth.api.createApiKey as unknown as Mock;
const listApiKeysMock = vi.mocked(auth.api.listApiKeys);

beforeEach(() => {
  vi.clearAllMocks();
  request.headers = {};
});

describe("permissionsForScopes", () => {
  it("returns the full action set for the ingest scope", () => {
    expect(permissionsForScopes(["ingest"])).toEqual({ ingest: ["write"] });
  });

  it("returns the full action set for the apply scope", () => {
    expect(permissionsForScopes(["apply"])).toEqual({
      apply: ["read", "write", "delete"],
    });
  });

  it("merges multiple scopes into a single permissions map", () => {
    expect(permissionsForScopes(["ingest", "apply"])).toEqual({
      ingest: ["write"],
      apply: ["read", "write", "delete"],
    });
  });

  it("returns an empty map for an empty scope list (server should reject this)", () => {
    expect(permissionsForScopes([])).toEqual({});
  });
});

describe("ApiKeyCreateInputSchema", () => {
  it("accepts a name plus both scopes", () => {
    const result = ApiKeyCreateInputSchema.parse({
      name: "prod",
      scopes: ["ingest", "apply"],
    });
    expect(result).toEqual({ name: "prod", scopes: ["ingest", "apply"] });
  });

  it("trims the name and rejects an empty one", () => {
    const trimmed = ApiKeyCreateInputSchema.parse({
      name: "  prod  ",
      scopes: ["ingest"],
    });
    expect(trimmed.name).toBe("prod");

    expect(() => ApiKeyCreateInputSchema.parse({ name: "   ", scopes: ["ingest"] })).toThrow();
  });

  it("requires at least one scope", () => {
    expect(() => ApiKeyCreateInputSchema.parse({ name: "prod", scopes: [] })).toThrow(
      /at least one/i,
    );
  });

  it("rejects an unknown scope", () => {
    expect(() =>
      ApiKeyCreateInputSchema.parse({
        name: "prod",
        scopes: ["ingest", "delete-everything"],
      }),
    ).toThrow();
  });

  it("requires a positive integer when expiresInDays is provided", () => {
    expect(() =>
      ApiKeyCreateInputSchema.parse({
        name: "prod",
        scopes: ["ingest"],
        expiresInDays: 0,
      }),
    ).toThrow();
    expect(() =>
      ApiKeyCreateInputSchema.parse({
        name: "prod",
        scopes: ["ingest"],
        expiresInDays: -1,
      }),
    ).toThrow();
    expect(() =>
      ApiKeyCreateInputSchema.parse({
        name: "prod",
        scopes: ["ingest"],
        expiresInDays: 1.5,
      }),
    ).toThrow();
    const ok = ApiKeyCreateInputSchema.parse({
      name: "prod",
      scopes: ["ingest"],
      expiresInDays: 30,
    });
    expect(ok.expiresInDays).toBe(30);
  });

  it("rejects unknown keys (strict object)", () => {
    expect(() =>
      ApiKeyCreateInputSchema.parse({
        name: "prod",
        scopes: ["ingest"],
        configId: "ingest",
      }),
    ).toThrow();
  });
});

describe("createApiKey (server fn)", () => {
  it("calls auth.api.createApiKey with the mapped permissions and active org", async () => {
    createApiKeyMock.mockResolvedValueOnce({
      key: "ek_test_value",
      id: "ak_1",
      permissions: { ingest: ["write"] },
    });

    const result = await createApiKey({
      data: { name: "prod", scopes: ["ingest"] },
    });

    expect(createApiKeyMock).toHaveBeenCalledTimes(1);
    const call = createApiKeyMock.mock.calls[0]?.[0] as {
      body: Record<string, unknown>;
    };
    expect(call.body).toMatchObject({
      configId: "ingest",
      name: "prod",
      organizationId: "test_org",
      userId: "test_user",
      permissions: { ingest: ["write"] },
    });
    // `permissions` is server-only: the call must NOT carry request headers,
    // or better-auth treats it as a client request and rejects it.
    expect("headers" in call).toBe(false);
    // No expiresIn key when not provided.
    expect("expiresIn" in call.body).toBe(false);
    expect(result).toEqual({
      key: "ek_test_value",
      id: "ak_1",
      permissions: { ingest: ["write"] },
    });
  });

  it("forwards expiresInDays as seconds when provided", async () => {
    createApiKeyMock.mockResolvedValueOnce({
      key: "ek_test_value",
      id: "ak_1",
      permissions: { ingest: ["write"], apply: ["read", "write", "delete"] },
    });

    await createApiKey({
      data: { name: "ci", scopes: ["ingest", "apply"], expiresInDays: 30 },
    });

    const call = createApiKeyMock.mock.calls[0]?.[0] as {
      body: Record<string, unknown>;
    };
    expect(call.body.expiresIn).toBe(30 * 24 * 60 * 60);
  });

  it("rejects when no scope is selected", async () => {
    await expect(createApiKey({ data: { name: "prod", scopes: [] } })).rejects.toThrow(
      /at least one/i,
    );
    expect(createApiKeyMock).not.toHaveBeenCalled();
  });

  it("returns the server-reported permissions when present, else the mapped set", async () => {
    createApiKeyMock.mockResolvedValueOnce({
      key: "ek_1",
      id: "ak_1",
      // server returns a normalized permissions map
      permissions: { apply: ["read", "write", "delete"] },
    });
    const a = await createApiKey({
      data: { name: "ci", scopes: ["apply"] },
    });
    expect(a.permissions).toEqual({ apply: ["read", "write", "delete"] });

    createApiKeyMock.mockResolvedValueOnce({
      key: "ek_2",
      id: "ak_2",
      // server omits permissions in the response
    });
    const b = await createApiKey({
      data: { name: "ci", scopes: ["ingest", "apply"] },
    });
    expect(b.permissions).toEqual({
      ingest: ["write"],
      apply: ["read", "write", "delete"],
    });
  });

  it("throws when the server does not return a key", async () => {
    createApiKeyMock.mockResolvedValueOnce({ id: "ak_1" });
    await expect(createApiKey({ data: { name: "prod", scopes: ["ingest"] } })).rejects.toThrow(
      /did not return a key/i,
    );
  });

  it("throws when the server returns a null key", async () => {
    createApiKeyMock.mockResolvedValueOnce({ id: "ak_1", key: null });
    await expect(createApiKey({ data: { name: "prod", scopes: ["ingest"] } })).rejects.toThrow(
      /did not return a key/i,
    );
  });
});

describe("listApiKeys provider passthrough", () => {
  const key: ApiKey = {
    id: "ak_1",
    configId: "ingest",
    name: "CI key",
    start: "ek_masked",
    prefix: "ek_",
    createdAt: new Date("2026-10-20T10:00:00Z"),
    expiresAt: null,
    lastRequest: null,
    permissions: { ingest: ["write"], apply: ["read"] },
    metadata: null,
  };

  it("preserves provider rows without projecting their fields", async () => {
    const providerRow = { ...key, referenceId: "test_org", enabled: true };
    listApiKeysMock.mockResolvedValueOnce({ apiKeys: [providerRow] } as never);
    const listed = await listApiKeys();
    expect(listed).toEqual([providerRow]);
    expect(listed[0]).toBe(providerRow);
    expect(listApiKeysMock).toHaveBeenCalledWith({
      query: { configId: "ingest", organizationId: "test_org" },
      headers: {},
    });
  });

  it("preserves public-key metadata returned by the provider", async () => {
    const metadata = { public: true, allowedOrigins: ["https://example.com"] };
    listApiKeysMock.mockResolvedValueOnce({ apiKeys: [{ ...key, metadata }] } as never);
    expect((await listApiKeys())[0].metadata).toEqual(metadata);
  });

  it("retains unrelated JSON metadata on secret keys", async () => {
    const metadata = { owner: "automation", options: [true, null, 42] };
    listApiKeysMock.mockResolvedValueOnce({ apiKeys: [{ ...key, metadata }] } as never);
    expect((await listApiKeys())[0].metadata).toEqual(metadata);
  });

  it.each([
    { metadata: [] },
    { metadata: ["ci", "automation"] },
    { metadata: [{ labels: ["ci"], enabled: true }] },
  ])(
    "retains provider-supported array metadata without breaking the key list: %j",
    async ({ metadata }) => {
      listApiKeysMock.mockResolvedValueOnce({ apiKeys: [{ ...key, metadata }, key] } as never);
      const listed = await listApiKeys();
      expect(listed).toHaveLength(2);
      expect(listed[0].metadata).toEqual(metadata);
      expect(listed[1].id).toBe(key.id);
    },
  );

  it("keeps empty lists and filters out other key configurations", async () => {
    listApiKeysMock.mockResolvedValueOnce({ apiKeys: [] } as never);
    expect(await listApiKeys()).toEqual([]);
    listApiKeysMock.mockResolvedValueOnce({
      apiKeys: [key, { ...key, id: "other", configId: "other" }],
    } as never);
    expect(await listApiKeys()).toEqual([key]);
  });

  it("propagates provider errors rather than presenting an empty list", async () => {
    const error = new Error("API key service unavailable");
    listApiKeysMock.mockRejectedValueOnce(error);
    await expect(listApiKeys()).rejects.toBe(error);
  });

  it("lists array metadata created through the real provider's HTTP endpoint", async () => {
    const provider = betterAuth({
      baseURL: "http://localhost:3000",
      secret: "api-key-provider-contract-test-secret",
      database: memoryAdapter({
        user: [],
        account: [],
        session: [],
        verification: [],
        organization: [],
        member: [],
        invitation: [],
        apikey: [],
      }),
      advanced: {
        database: {
          generateId: ({ model }) => (model === "organization" ? "test_org" : crypto.randomUUID()),
        },
      },
      emailAndPassword: { enabled: true },
      plugins: [
        organization(),
        apiKey([
          {
            configId: "ingest",
            references: "organization",
            defaultPrefix: "ek_",
            requireName: true,
            enableMetadata: true,
            rateLimit: { enabled: false },
          },
        ]),
      ],
    });
    const signedIn = await provider.api.signUpEmail({
      body: { name: "Owner", email: "owner@example.test", password: "contract-test-password" },
      asResponse: true,
    });
    expect(signedIn.status).toBe(200);
    const headers = new Headers({ cookie: signedIn.headers.get("set-cookie") ?? "" });
    const org = await provider.api.createOrganization({
      headers,
      body: { name: "Contract test", slug: "contract-test" },
    });
    expect(org?.id).toBe("test_org");
    const metadata = ["ci", "automation"];
    const create = (value: unknown) =>
      provider.handler(
        new Request("http://localhost:3000/api/auth/api-key/create", {
          method: "POST",
          headers: new Headers({
            cookie: headers.get("cookie") ?? "",
            "content-type": "application/json",
          }),
          body: JSON.stringify({
            configId: "ingest",
            organizationId: org?.id,
            name: "CI",
            metadata: value,
          }),
        }),
      );
    expect((await create(metadata)).status).toBe(200);
    expect((await create("unsupported string metadata")).status).toBe(400);
    request.headers = headers;
    listApiKeysMock.mockImplementationOnce((options) => provider.api.listApiKeys(options));
    const listed = await listApiKeys();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ configId: "ingest", metadata });
    expect(listed[0]).not.toHaveProperty("key");
    expect(listed[0]).toHaveProperty("referenceId", "test_org");
  });
});

describe("createApiKey response compatibility", () => {
  it.each([
    { id: "ak_1", key: "" },
    { id: "ak_1", key: "ek_key", permissions: { ingest: "write" } },
    { id: "ak_1", key: "ek_key", permissions: { ingest: [42] } },
  ])("preserves previously accepted provider creation results: %j", async (response) => {
    createApiKeyMock.mockResolvedValueOnce(response);
    expect(await createApiKey({ data: { name: "prod", scopes: ["ingest"] } })).toEqual({
      id: response.id,
      key: response.key,
      permissions: "permissions" in response ? response.permissions : { ingest: ["write"] },
    });
  });

  it("keeps missing-key errors free of added validation causes", async () => {
    createApiKeyMock.mockResolvedValueOnce({ id: "", key: "ek_key" });
    await expect(createApiKey({ data: { name: "prod", scopes: ["ingest"] } })).rejects.toEqual(
      new Error("Server did not return a key"),
    );
  });

  it.each([null, undefined, {}, { apiKeys: null }])(
    "keeps the empty fallback for %j",
    async (response) => {
      listApiKeysMock.mockResolvedValueOnce(response as never);
      expect(await listApiKeys()).toEqual([]);
    },
  );

  it("passes through provider metadata without new JSON validation", async () => {
    const metadata = { value: undefined, unsupported: () => "legacy" };
    const row = { id: "ak_1", configId: "ingest", metadata };
    listApiKeysMock.mockResolvedValueOnce({ apiKeys: [row] } as never);
    const listed = await listApiKeys();
    expect(listed[0]).toBe(row);
    expect(listed[0].metadata).toBe(metadata);
  });
});
