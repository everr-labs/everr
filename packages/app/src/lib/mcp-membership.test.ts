import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock } = vi.hoisted(() => ({ selectMock: vi.fn() }));
vi.mock("@/db/client", () => ({
  db: { select: (...a: unknown[]) => selectMock(...a) },
}));

import { assertCurrentMember, McpMembershipError } from "./mcp-membership";

function returning(rows: unknown[]) {
  return {
    from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
  };
}
beforeEach(() => selectMock.mockReset());

describe("assertCurrentMember", () => {
  it("resolves when a membership row exists", async () => {
    selectMock.mockReturnValueOnce(returning([{ id: "m-1" }]));
    await expect(assertCurrentMember("u", "org-1")).resolves.toBeUndefined();
  });
  it("throws when no membership", async () => {
    selectMock.mockReturnValueOnce(returning([]));
    await expect(assertCurrentMember("u", "org-1")).rejects.toBeInstanceOf(
      McpMembershipError,
    );
  });
});
