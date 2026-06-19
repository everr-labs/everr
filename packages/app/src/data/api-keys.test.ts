import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { auth } from "@/lib/auth.server";
import {
  ApiKeyCreateInputSchema,
  createApiKey,
  permissionsForScopes,
} from "./api-keys";

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => ({}),
}));

const createApiKeyMock = auth.api.createApiKey as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
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

    expect(() =>
      ApiKeyCreateInputSchema.parse({ name: "   ", scopes: ["ingest"] }),
    ).toThrow();
  });

  it("requires at least one scope", () => {
    expect(() =>
      ApiKeyCreateInputSchema.parse({ name: "prod", scopes: [] }),
    ).toThrow(/at least one/i);
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
    await expect(
      createApiKey({ data: { name: "prod", scopes: [] } }),
    ).rejects.toThrow(/at least one/i);
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
    await expect(
      createApiKey({ data: { name: "prod", scopes: ["ingest"] } }),
    ).rejects.toThrow(/did not return a key/i);
  });
});
