import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above imports, so the factory cannot close over an
// ordinary top-level const (TDZ). vi.hoisted runs first and is safe to reference.
const { selectMock } = vi.hoisted(() => ({ selectMock: vi.fn() }));

vi.mock("@/db/client", () => ({
  db: { select: (...a: unknown[]) => selectMock(...a) },
}));

import { McpOrgError, resolveMcpOrg } from "./mcp-org";

// session query chain: from().where().orderBy().limit()
function sessionReturning(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(rows) }) }),
    }),
  };
}
// membership check chain: from().where().limit()
function memberReturning(rows: unknown[]) {
  return { from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) };
}
// first-membership chain: from().where().orderBy().limit()
const firstReturning = sessionReturning;

beforeEach(() => selectMock.mockReset());

describe("resolveMcpOrg", () => {
  it("returns the last-used org when still a member", async () => {
    selectMock
      .mockReturnValueOnce(sessionReturning([{ organizationId: "org-last" }]))
      .mockReturnValueOnce(memberReturning([{ id: "m-1" }]));
    await expect(resolveMcpOrg("user-1")).resolves.toBe("org-last");
  });

  it("falls back to first membership when no session org", async () => {
    selectMock
      .mockReturnValueOnce(sessionReturning([])) // no last-used
      .mockReturnValueOnce(firstReturning([{ organizationId: "org-first" }]));
    await expect(resolveMcpOrg("user-1")).resolves.toBe("org-first");
  });

  it("falls back to first membership when last-used org is no longer a membership", async () => {
    selectMock
      .mockReturnValueOnce(sessionReturning([{ organizationId: "org-stale" }]))
      .mockReturnValueOnce(memberReturning([])) // not a member anymore
      .mockReturnValueOnce(firstReturning([{ organizationId: "org-first" }]));
    await expect(resolveMcpOrg("user-1")).resolves.toBe("org-first");
  });

  it("throws when the user has no org at all", async () => {
    selectMock
      .mockReturnValueOnce(sessionReturning([]))
      .mockReturnValueOnce(firstReturning([]));
    await expect(resolveMcpOrg("user-1")).rejects.toBeInstanceOf(McpOrgError);
  });
});
