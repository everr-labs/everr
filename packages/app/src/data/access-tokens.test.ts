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
  accessTokens: {
    id: "access_tokens.id",
    organizationId: "access_tokens.organization_id",
    userId: "access_tokens.user_id",
    name: "access_tokens.name",
    tokenHash: "access_tokens.token_hash",
    tokenPrefix: "access_tokens.token_prefix",
    createdAt: "access_tokens.created_at",
  },
}));

vi.mock("@/lib/access-token", () => ({
  generateAccessToken: vi.fn(() => "eacc_test_token"),
  hashAccessToken: vi.fn(() => "hashed_test_token"),
  getAccessTokenPrefix: vi.fn(() => "eacc_test_prefix_"),
  obfuscateAccessTokenPrefix: vi.fn((prefix: string) => `${prefix}********`),
}));

import { getAuth } from "@workos/authkit-tanstack-react-start";
import { createAccessToken } from "./access-tokens";

const mockedGetAuth = vi.mocked(getAuth);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createAccessToken", () => {
  it("creates and returns token details for authenticated user/org", async () => {
    mockedGetAuth.mockResolvedValue({
      user: { id: "user_123" },
      organizationId: "org_123",
    } as never);

    const createdAt = new Date("2026-01-01T00:00:00Z");
    mocked.insertReturning.mockResolvedValue([
      {
        id: 1,
        name: "access-token-abc12345",
        tokenPrefix: "eacc_test_prefix_",
        createdAt,
      },
    ]);

    const result = await createAccessToken();

    expect(result).toEqual({
      id: 1,
      name: "access-token-abc12345",
      value: "eacc_test_token",
      tokenPrefix: "eacc_test_prefix_",
      obfuscatedValue: "eacc_test_prefix_********",
      createdAt,
    });
    expect(mocked.insert).toHaveBeenCalledTimes(1);
    expect(mocked.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_123",
        userId: "user_123",
        name: expect.stringMatching(/^access-token-[a-f0-9]{8}$/),
        tokenHash: "hashed_test_token",
        tokenPrefix: "eacc_test_prefix_",
      }),
    );
  });

  it("throws when user is not authenticated or organization is missing", async () => {
    mockedGetAuth.mockResolvedValue({
      user: null,
      organizationId: null,
    } as never);

    await expect(createAccessToken()).rejects.toThrow(
      "You need an active organization to create a token.",
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

    await expect(createAccessToken()).rejects.toThrow(
      "We couldn't create your token right now. Please try again. (ref: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa)",
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[access-tokens] create_failed",
      expect.objectContaining({
        requestId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        userId: "user_123",
        organizationId: "org_123",
      }),
    );
  });
});
