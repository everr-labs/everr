import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
  const selectLimit = vi.fn();
  const selectWhere = vi.fn(() => ({
    limit: selectLimit,
  }));
  const selectInnerJoin = vi.fn(() => ({
    where: selectWhere,
  }));
  const selectFrom = vi.fn(() => ({
    innerJoin: selectInnerJoin,
  }));
  const select = vi.fn(() => ({
    from: selectFrom,
  }));

  return {
    select,
    selectFrom,
    selectInnerJoin,
    selectWhere,
    selectLimit,
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn(() => "and_clause"),
  eq: vi.fn(() => "eq_clause"),
  gt: vi.fn(() => "gt_clause"),
  isNull: vi.fn(() => "is_null_clause"),
}));

vi.mock("@/db/client", () => ({
  db: {
    select: mocked.select,
  },
}));

vi.mock("@/db/schema", () => ({
  accessTokens: {
    id: "access_tokens.id",
    organizationId: "access_tokens.organization_id",
    userId: "access_tokens.user_id",
    name: "access_tokens.name",
    tokenHash: "access_tokens.token_hash",
    revokedAt: "access_tokens.revoked_at",
    expiresAt: "access_tokens.expires_at",
  },
  tenants: {
    id: "tenants.id",
    externalId: "tenants.external_id",
  },
}));

import { getBearerToken, validateAccessToken } from "./access-token-auth";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getBearerToken", () => {
  it("returns token when header is valid bearer", () => {
    const headers = new Headers({
      authorization: "Bearer abc123",
    });

    expect(getBearerToken(headers)).toBe("abc123");
  });

  it("returns null for missing or invalid authorization header", () => {
    expect(getBearerToken(new Headers())).toBeNull();
    expect(
      getBearerToken(new Headers({ authorization: "Basic abc123" })),
    ).toBeNull();
    expect(getBearerToken(new Headers({ authorization: "Bearer" }))).toBeNull();
  });
});

describe("validateAccessToken", () => {
  it("returns null for empty token", async () => {
    await expect(validateAccessToken("")).resolves.toBeNull();
    expect(mocked.select).not.toHaveBeenCalled();
  });

  it("returns null when token hash is not found", async () => {
    mocked.selectLimit.mockResolvedValue([]);

    await expect(validateAccessToken("ctmcp_missing")).resolves.toBeNull();
    expect(mocked.select).toHaveBeenCalledTimes(1);
    expect(mocked.selectInnerJoin).toHaveBeenCalledTimes(1);
    expect(mocked.selectWhere).toHaveBeenCalledTimes(1);
  });

  it("returns mapped token fields when token is valid", async () => {
    mocked.selectLimit.mockResolvedValue([
      {
        tokenId: 9,
        tenantId: 77,
        organizationId: "org_123",
        userId: "user_123",
        name: "access-token-abcdef12",
      },
    ]);

    await expect(validateAccessToken("eacc_valid")).resolves.toEqual({
      tokenId: 9,
      tenantId: 77,
      organizationId: "org_123",
      userId: "user_123",
      name: "access-token-abcdef12",
    });
  });

  it("accepts both legacy and new token prefixes", async () => {
    mocked.selectLimit.mockResolvedValue([
      {
        tokenId: 9,
        tenantId: 77,
        organizationId: "org_123",
        userId: "user_123",
        name: "access-token-abcdef12",
      },
    ]);

    await expect(validateAccessToken("ctmcp_legacy_value")).resolves.toEqual(
      expect.objectContaining({ tokenId: 9 }),
    );
    await expect(validateAccessToken("eacc_new_value")).resolves.toEqual(
      expect.objectContaining({ tokenId: 9 }),
    );
  });
});
