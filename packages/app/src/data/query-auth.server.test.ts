import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { resolveQueryAuth } from "./query-auth.server";

const verifyApiKey = vi.fn();
const getSession = vi.fn();
vi.mock("#app/identity/server.ts", () => ({
  auth: { api: { verifyApiKey: (...a: unknown[]) => verifyApiKey(...a) } },
}));
vi.mock("#app/lib/session.server.ts", () => ({
  getSession: (...a: unknown[]) => getSession(...a),
}));
vi.mock("#app/db/client.ts", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([{ metadata: null }]) }) }),
    }),
  },
}));

const bearer = (token: string) => new Headers({ authorization: `Bearer ${token}` });
const key = (permissions: Record<string, string[]>) => ({
  valid: true,
  key: { id: "k1", referenceId: "org-1", permissions },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveQueryAuth", () => {
  it("lets a key with the query capability read its organization's telemetry", async () => {
    verifyApiKey.mockResolvedValueOnce(key({ query: ["read"] }));
    expect(await resolveQueryAuth(bearer("ek_abc"))).toEqual({
      organizationId: "org-1",
      organizationMetadata: null,
    });
  });

  it("refuses a key minted to send telemetry or to apply resources", async () => {
    verifyApiKey.mockResolvedValueOnce(key({ ingest: ["write"], apply: ["read", "write"] }));
    await expect(resolveQueryAuth(bearer("ek_abc"))).rejects.toMatchObject({
      message: "API key is not authorized to query telemetry",
      status: 403,
    });
  });

  it("refuses an invalid key", async () => {
    verifyApiKey.mockResolvedValueOnce({ valid: false });
    await expect(resolveQueryAuth(bearer("ek_abc"))).rejects.toMatchObject({ status: 401 });
  });

  it("takes a logged-in session's active organization", async () => {
    getSession.mockResolvedValueOnce({
      session: { activeOrganizationId: "org-2" },
      user: { id: "u1" },
    });
    expect(await resolveQueryAuth(bearer("session-token"))).toMatchObject({
      organizationId: "org-2",
    });
    expect(verifyApiKey).not.toHaveBeenCalled();
  });

  it("refuses a request with no credential", async () => {
    await expect(resolveQueryAuth(new Headers())).rejects.toMatchObject({ status: 401 });
  });
});
