import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyApiKey = vi.fn();
const getSession = vi.fn();
vi.mock("@/lib/auth.server", () => ({
  auth: {
    api: {
      verifyApiKey: (...a: unknown[]) => verifyApiKey(...a),
      getSession: (...a: unknown[]) => getSession(...a),
    },
  },
}));
vi.mock("@/lib/clickhouse", () => ({
  createClickhouseQuery: () => () => Promise.resolve([]),
}));

// Org-name lookup goes through a direct DB select; control its result via orgRows.
let orgRows: unknown[] = [];
vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(orgRows),
        }),
      }),
    }),
  },
}));
vi.mock("@/db/schema", () => ({
  organization: { id: "id", name: "name" },
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
  orgRows = [];
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
  it("throws when there is no credential", async () => {
    await expect(resolveApplyAuth(headers({}))).rejects.toThrow(
      /missing credential/i,
    );
  });

  it("resolves an ek_ ingest key to its org (+name)", async () => {
    verifyApiKey.mockResolvedValueOnce({
      valid: true,
      key: { id: "k1", referenceId: "org-1" },
    });
    orgRows = [{ name: "Acme" }];
    const result = await resolveApplyAuth(
      headers({ authorization: "Bearer ek_abc" }),
    );
    expect(result).toEqual({
      organizationId: "org-1",
      organizationName: "Acme",
      principalId: "apikey:k1",
    });
    expect(verifyApiKey).toHaveBeenCalledWith({
      body: { key: "ek_abc", configId: "ingest" },
    });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("falls back to the org id when the org row is missing", async () => {
    verifyApiKey.mockResolvedValueOnce({
      valid: true,
      key: { id: "k1", referenceId: "org-1" },
    });
    orgRows = [];
    const result = await resolveApplyAuth(
      headers({ authorization: "Bearer ek_abc" }),
    );
    expect(result.organizationName).toBe("org-1");
  });

  it("throws when an ek_ key is invalid", async () => {
    verifyApiKey.mockResolvedValueOnce({ valid: false, key: null });
    await expect(
      resolveApplyAuth(headers({ authorization: "Bearer ek_nope" })),
    ).rejects.toThrow(/invalid api key/i);
  });

  it("resolves a session bearer to the active org (+name)", async () => {
    getSession.mockResolvedValueOnce({
      user: { id: "u1" },
      session: { activeOrganizationId: "org-9" },
    });
    orgRows = [{ name: "Globex" }];
    const result = await resolveApplyAuth(
      headers({ authorization: "Bearer sess_token" }),
    );
    expect(result).toEqual({
      organizationId: "org-9",
      organizationName: "Globex",
      principalId: "user:u1",
    });
    expect(verifyApiKey).not.toHaveBeenCalled();
  });

  it("throws when the session has no active org", async () => {
    getSession.mockResolvedValueOnce({
      user: { id: "u1" },
      session: { activeOrganizationId: null },
    });
    await expect(
      resolveApplyAuth(headers({ authorization: "Bearer sess_token" })),
    ).rejects.toThrow(/no active organization/i);
  });

  it("throws when the session is invalid", async () => {
    getSession.mockResolvedValueOnce(null);
    await expect(
      resolveApplyAuth(headers({ authorization: "Bearer sess_token" })),
    ).rejects.toThrow(/unauthenticated/i);
  });
});

describe("buildApplyContext", () => {
  it("exposes the resolved org as active org and in context.organization", () => {
    const ctx = buildApplyContext({
      organizationId: "org-k",
      organizationName: "Kettle",
      principalId: "apikey:1",
    });
    expect(ctx.session.session.activeOrganizationId).toBe("org-k");
    expect(ctx.session.user.id).toBe("apikey:1");
    expect(ctx.organization).toEqual({ id: "org-k", name: "Kettle" });
  });
});
