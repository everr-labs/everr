import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above imports, so the factory cannot close over an
// ordinary top-level const (TDZ). vi.hoisted runs first and is safe to reference.
const { selectMock } = vi.hoisted(() => ({ selectMock: vi.fn() }));

vi.mock("@/db/client", () => ({
  db: { select: (...a: unknown[]) => selectMock(...a) },
}));

import { McpOrgError, resolveMcpOrg } from "./mcp-org";

// last-used (join) chain: from().innerJoin().where().orderBy().limit()
function lastUsedReturning(rows: unknown[]) {
  return {
    from: () => ({
      innerJoin: () => ({
        where: () => ({
          orderBy: () => ({ limit: () => Promise.resolve(rows) }),
        }),
      }),
    }),
  };
}
// first-membership chain: from().where().orderBy().limit()
function firstReturning(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        orderBy: () => ({ limit: () => Promise.resolve(rows) }),
      }),
    }),
  };
}

beforeEach(() => selectMock.mockReset());

describe("resolveMcpOrg", () => {
  it("returns the last-used org when still a member", async () => {
    selectMock.mockReturnValueOnce(
      lastUsedReturning([{ organizationId: "org-last" }]),
    );
    await expect(resolveMcpOrg("user-1")).resolves.toBe("org-last");
    expect(selectMock).toHaveBeenCalledTimes(1); // happy path = one round-trip
  });

  it("falls back to first membership when there is no usable last-used org", async () => {
    // The join returns nothing when the active org is missing OR no longer a
    // membership — both cases land here.
    selectMock
      .mockReturnValueOnce(lastUsedReturning([]))
      .mockReturnValueOnce(firstReturning([{ organizationId: "org-first" }]));
    await expect(resolveMcpOrg("user-1")).resolves.toBe("org-first");
  });

  it("throws when the user has no org at all", async () => {
    selectMock
      .mockReturnValueOnce(lastUsedReturning([]))
      .mockReturnValueOnce(firstReturning([]));
    await expect(resolveMcpOrg("user-1")).rejects.toBeInstanceOf(McpOrgError);
  });
});
