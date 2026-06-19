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
  applyAuthErrorResponse,
  buildApplyContext,
  extractBearerKey,
  requireOrgOrApiKeyMiddleware,
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

  it("resolves an ek_ key with the apply scope to its org (+name)", async () => {
    verifyApiKey.mockResolvedValueOnce({
      valid: true,
      // Real apply keys carry the concrete action set, not a wildcard.
      key: {
        id: "k1",
        referenceId: "org-1",
        permissions: { apply: ["read", "write", "delete"] },
      },
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

  it("rejects an ek_ key with no permissions map", async () => {
    // A key with no capabilities grants nothing. Legacy keys are backfilled
    // with explicit capabilities by the 0006 migration, so a null map only
    // reaches here for a key that genuinely has none.
    verifyApiKey.mockResolvedValueOnce({
      valid: true,
      key: { id: "k1", referenceId: "org-1", permissions: null },
    });
    await expect(
      resolveApplyAuth(headers({ authorization: "Bearer ek_abc" })),
    ).rejects.toThrow(/not authorized to apply/i);
  });

  it("rejects an ek_ key that only has the ingest scope", async () => {
    verifyApiKey.mockResolvedValueOnce({
      valid: true,
      key: {
        id: "k1",
        referenceId: "org-1",
        permissions: { ingest: ["write"] },
      },
    });
    await expect(
      resolveApplyAuth(headers({ authorization: "Bearer ek_abc" })),
    ).rejects.toThrow(/not authorized to apply/i);
  });

  it("falls back to the org id when the org row is missing", async () => {
    verifyApiKey.mockResolvedValueOnce({
      valid: true,
      key: { id: "k1", referenceId: "org-1", permissions: { apply: ["*"] } },
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

describe("applyAuthErrorResponse", () => {
  it.each([
    ["Missing credential", 401],
    ["Invalid API key", 401],
    ["API key is not authorized to apply resources", 403],
    ["Unauthenticated", 401],
    ["No active organization", 403],
  ])("maps %s to an HTTP %d Response with the message", async (msg, status) => {
    const res = applyAuthErrorResponse(new Error(msg));
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(status);
    expect(await (res as Response).json()).toEqual({ error: msg });
  });

  it("returns null for an unknown (non-auth) error so it propagates as 500", () => {
    expect(
      applyAuthErrorResponse(new Error("connect ECONNREFUSED")),
    ).toBeNull();
    expect(applyAuthErrorResponse("not an error")).toBeNull();
  });
});

describe("requireOrgOrApiKeyMiddleware", () => {
  // The global test-setup mocks @tanstack/react-start so the middleware exposes
  // a callable __handler.
  const handler = (
    requireOrgOrApiKeyMiddleware as unknown as {
      __handler: (a: {
        request: { headers: Headers };
        context: Record<string, unknown>;
        next: (a?: unknown) => Promise<unknown>;
      }) => Promise<unknown>;
    }
  ).__handler;

  it("throws a 401 Response (not a generic error) when the credential is missing", async () => {
    let thrown: unknown;
    try {
      await handler({
        request: { headers: headers({}) },
        context: {},
        next: async () => undefined,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(401);
  });

  it("throws a 403 Response when the session has no active org", async () => {
    getSession.mockResolvedValueOnce({
      user: { id: "u1" },
      session: { activeOrganizationId: null },
    });
    let thrown: unknown;
    try {
      await handler({
        request: { headers: headers({ authorization: "Bearer sess_token" }) },
        context: {},
        next: async () => undefined,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(403);
  });

  it("calls next with the resolved org context on success", async () => {
    verifyApiKey.mockResolvedValueOnce({
      valid: true,
      key: { id: "k1", referenceId: "org-1", permissions: { apply: ["*"] } },
    });
    orgRows = [{ name: "Acme" }];
    const next = vi.fn(async (_arg?: unknown) => "ok");
    const result = await handler({
      request: { headers: headers({ authorization: "Bearer ek_abc" }) },
      context: {},
      next,
    });
    expect(result).toBe("ok");
    expect(next).toHaveBeenCalledTimes(1);
    const arg = next.mock.calls[0]?.[0] as {
      context: { organization: { id: string; name: string } };
    };
    expect(arg.context.organization).toEqual({ id: "org-1", name: "Acme" });
  });
});
