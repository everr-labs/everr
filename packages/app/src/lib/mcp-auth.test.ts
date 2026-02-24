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
  isNull: vi.fn(() => "is_null_clause"),
}));

vi.mock("@/db/client", () => ({
  db: {
    select: mocked.select,
  },
}));

vi.mock("@/lib/workos", () => ({
  getWorkOS: vi.fn(),
}));

vi.mock("@/db/schema", () => ({
  mcpTokens: {
    id: "mcp_tokens.id",
    organizationId: "mcp_tokens.organization_id",
    userId: "mcp_tokens.user_id",
    name: "mcp_tokens.name",
    tokenHash: "mcp_tokens.token_hash",
    revokedAt: "mcp_tokens.revoked_at",
  },
  tenants: {
    id: "tenants.id",
    externalId: "tenants.external_id",
  },
}));

import { getWorkOS } from "@/lib/workos";
import { getBearerToken, validateMcpApiKey } from "./mcp-auth";

const listOrganizationMemberships = vi.fn();
const mockedGetWorkOS = vi.mocked(getWorkOS);

beforeEach(() => {
  vi.clearAllMocks();
  listOrganizationMemberships.mockResolvedValue({
    data: [{ id: "om_123", status: "active" }],
  });
  mockedGetWorkOS.mockReturnValue({
    userManagement: {
      listOrganizationMemberships,
    },
  } as never);
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

describe("validateMcpApiKey", () => {
  it("returns null for empty token", async () => {
    await expect(validateMcpApiKey("")).resolves.toBeNull();
    expect(mocked.select).not.toHaveBeenCalled();
  });

  it("returns null when token hash is not found", async () => {
    mocked.selectLimit.mockResolvedValue([]);

    await expect(validateMcpApiKey("ctmcp_missing")).resolves.toBeNull();
    expect(mocked.select).toHaveBeenCalledTimes(1);
    expect(mocked.selectInnerJoin).toHaveBeenCalledTimes(1);
    expect(mocked.selectWhere).toHaveBeenCalledTimes(1);
    expect(listOrganizationMemberships).not.toHaveBeenCalled();
  });

  it("returns mapped token fields when token is valid", async () => {
    mocked.selectLimit.mockResolvedValue([
      {
        tokenId: 9,
        tenantId: 77,
        organizationId: "org_123",
        userId: "user_123",
        name: "mcp-server-abcdef12",
      },
    ]);

    await expect(validateMcpApiKey("ctmcp_valid")).resolves.toEqual({
      tokenId: 9,
      tenantId: 77,
      organizationId: "org_123",
      userId: "user_123",
      name: "mcp-server-abcdef12",
    });
    expect(listOrganizationMemberships).toHaveBeenCalledWith({
      userId: "user_123",
      organizationId: "org_123",
      statuses: ["active"],
      limit: 1,
    });
  });

  it("returns null when user has no active membership in organization", async () => {
    mocked.selectLimit.mockResolvedValue([
      {
        tokenId: 9,
        tenantId: 77,
        organizationId: "org_123",
        userId: "user_123",
        name: "mcp-server-abcdef12",
      },
    ]);
    listOrganizationMemberships.mockResolvedValue({ data: [] });

    await expect(validateMcpApiKey("ctmcp_valid")).resolves.toBeNull();
  });
});
