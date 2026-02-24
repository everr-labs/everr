import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
  const insertReturning = vi.fn();
  const insertValues = vi.fn(() => ({
    returning: insertReturning,
  }));
  const insert = vi.fn(() => ({
    values: insertValues,
  }));

  return {
    insert,
    insertValues,
    insertReturning,
  };
});

vi.mock("@workos/authkit-tanstack-react-start", () => ({
  getAuth: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: vi.fn(() => ({
    handler: (fn: (...args: unknown[]) => unknown) => fn,
  })),
}));

vi.mock("@/db/client", () => ({
  db: {
    insert: mocked.insert,
  },
}));

vi.mock("@/db/schema", () => ({
  mcpTokens: {
    id: "mcp_tokens.id",
    organizationId: "mcp_tokens.organization_id",
    userId: "mcp_tokens.user_id",
    name: "mcp_tokens.name",
    tokenHash: "mcp_tokens.token_hash",
    tokenPrefix: "mcp_tokens.token_prefix",
    createdAt: "mcp_tokens.created_at",
  },
}));

vi.mock("@/lib/mcp-token", () => ({
  generateMcpToken: vi.fn(() => "ctmcp_test_token"),
  hashMcpToken: vi.fn(() => "hashed_test_token"),
  getMcpTokenPrefix: vi.fn(() => "ctmcp_test_pre"),
  obfuscateMcpTokenPrefix: vi.fn((prefix: string) => `${prefix}********`),
}));

import { getAuth } from "@workos/authkit-tanstack-react-start";
import { createMcpApiKey } from "./mcp-api-keys";

const mockedGetAuth = vi.mocked(getAuth);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createMcpApiKey", () => {
  it("creates and returns token details for authenticated user/org", async () => {
    mockedGetAuth.mockResolvedValue({
      user: { id: "user_123" },
      organizationId: "org_123",
    } as never);

    const createdAt = new Date("2026-01-01T00:00:00Z");
    mocked.insertReturning.mockResolvedValue([
      {
        id: 1,
        name: "mcp-server-abc12345",
        tokenPrefix: "ctmcp_test_pre",
        createdAt,
      },
    ]);

    const result = await createMcpApiKey();

    expect(result).toEqual({
      id: 1,
      name: "mcp-server-abc12345",
      value: "ctmcp_test_token",
      tokenPrefix: "ctmcp_test_pre",
      obfuscatedValue: "ctmcp_test_pre********",
      createdAt,
    });
    expect(mocked.insert).toHaveBeenCalledTimes(1);
    expect(mocked.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_123",
        userId: "user_123",
        name: expect.stringMatching(/^mcp-server-[a-f0-9]{8}$/),
        tokenHash: "hashed_test_token",
        tokenPrefix: "ctmcp_test_pre",
      }),
    );
  });

  it("throws when user is not authenticated or organization is missing", async () => {
    mockedGetAuth.mockResolvedValue({
      user: null,
      organizationId: null,
    } as never);

    await expect(createMcpApiKey()).rejects.toThrow(
      "You need an active organization to create an API key.",
    );
    expect(mocked.insert).not.toHaveBeenCalled();
  });

  it("returns safe error with request id when insert fails", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    );

    mockedGetAuth.mockResolvedValue({
      user: { id: "user_123" },
      organizationId: "org_123",
    } as never);
    mocked.insertReturning.mockRejectedValue(new Error("db down"));

    await expect(createMcpApiKey()).rejects.toThrow(
      "We couldn't create your MCP API token right now. Please try again. (ref: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa)",
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[mcp-api-keys] create_failed",
      expect.objectContaining({
        requestId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        userId: "user_123",
        organizationId: "org_123",
      }),
    );
  });
});
