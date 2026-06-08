// packages/app/src/data/as-code/apply-auth.server.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyApiKey = vi.fn();
vi.mock("@/lib/auth.server", () => ({
  auth: {
    api: { verifyApiKey: (...args: unknown[]) => verifyApiKey(...args) },
  },
}));

import {
  buildApplyContext,
  extractBearerKey,
  resolveApplyAuth,
} from "./apply-auth.server";

function headers(map: Record<string, string>): Headers {
  return new Headers(map);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("extractBearerKey", () => {
  it("reads a Bearer token from the Authorization header", () => {
    expect(extractBearerKey(headers({ authorization: "Bearer ek_abc" }))).toBe(
      "ek_abc",
    );
  });
  it("reads the x-api-key header", () => {
    expect(extractBearerKey(headers({ "x-api-key": "ek_xyz" }))).toBe("ek_xyz");
  });
  it("returns null when no key header is present", () => {
    expect(extractBearerKey(headers({}))).toBeNull();
  });
});

describe("resolveApplyAuth", () => {
  it("throws when there is no API key (sessions are not accepted)", async () => {
    await expect(resolveApplyAuth(headers({}))).rejects.toThrow(
      /missing api key/i,
    );
    expect(verifyApiKey).not.toHaveBeenCalled();
  });

  it("resolves an org-referenced ingest key to its org", async () => {
    verifyApiKey.mockResolvedValueOnce({
      valid: true,
      key: { id: "k1", referenceId: "org-1" },
    });
    const result = await resolveApplyAuth(
      headers({ authorization: "Bearer ek_abc" }),
    );
    expect(result).toEqual({
      organizationId: "org-1",
      principalId: "apikey:k1",
    });
    expect(verifyApiKey).toHaveBeenCalledWith({
      body: { key: "ek_abc", configId: "ingest" },
    });
  });

  it("resolves via the x-api-key header too", async () => {
    verifyApiKey.mockResolvedValueOnce({
      valid: true,
      key: { id: "k2", referenceId: "org-2" },
    });
    const result = await resolveApplyAuth(headers({ "x-api-key": "ek_def" }));
    expect(result).toEqual({
      organizationId: "org-2",
      principalId: "apikey:k2",
    });
  });

  it("throws when the key is invalid", async () => {
    verifyApiKey.mockResolvedValueOnce({ valid: false, key: null });
    await expect(
      resolveApplyAuth(headers({ authorization: "Bearer nope" })),
    ).rejects.toThrow(/invalid api key/i);
  });

  it("throws when a valid key has no referenceId", async () => {
    verifyApiKey.mockResolvedValueOnce({ valid: true, key: { id: "k3" } });
    await expect(
      resolveApplyAuth(headers({ authorization: "Bearer ek_weird" })),
    ).rejects.toThrow(/invalid api key/i);
  });
});

describe("buildApplyContext", () => {
  it("uses the API-key org as the active organization", () => {
    const ctx = buildApplyContext({
      organizationId: "org-k",
      principalId: "apikey:1",
    });
    expect(ctx.session.session.activeOrganizationId).toBe("org-k");
    expect(ctx.session.user.id).toBe("apikey:1");
  });
});
