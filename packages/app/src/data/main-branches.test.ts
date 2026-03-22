import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
  const insertOnConflictDoUpdate = vi.fn();
  const insertValues = vi.fn(() => ({
    onConflictDoUpdate: insertOnConflictDoUpdate,
  }));
  const insert = vi.fn(() => ({
    values: insertValues,
  }));

  const selectLimit = vi.fn();
  const selectOrderBy = vi.fn(() => ({
    limit: selectLimit,
  }));
  const selectWhere = vi.fn(() => ({
    limit: selectLimit,
    orderBy: selectOrderBy,
  }));
  const selectFrom = vi.fn(() => ({
    where: selectWhere,
  }));
  const select = vi.fn(() => ({
    from: selectFrom,
  }));

  return {
    insert,
    insertValues,
    insertOnConflictDoUpdate,
    select,
    selectLimit,
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn(() => "and_clause"),
  asc: vi.fn(() => "asc_clause"),
  eq: vi.fn(() => "eq_clause"),
  isNull: vi.fn(() => "is_null_clause"),
  or: vi.fn(() => "or_clause"),
  sql: vi.fn(() => "sql_clause"),
}));

vi.mock("@/db/schema", () => ({
  mainBranches: {
    id: "main_branches.id",
    tenantId: "main_branches.tenant_id",
    repository: "main_branches.repository",
    branches: "main_branches.branches",
  },
}));

vi.mock("@/db/client", () => ({
  db: {
    insert: mocked.insert,
    select: mocked.select,
  },
}));

import {
  DEFAULT_MAIN_BRANCHES,
  getMainBranches,
  getOrgMainBranches,
  setOrgMainBranches,
  setRepoMainBranches,
} from "./main-branches";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getMainBranches", () => {
  it("returns the first row when one exists (repo-specific wins by ordering)", async () => {
    mocked.selectLimit.mockResolvedValueOnce([
      { branches: ["main", "release"] },
    ]);

    const result = await getMainBranches(1, "everr-labs/everr");

    expect(result).toEqual(["main", "release"]);
    expect(mocked.select).toHaveBeenCalledTimes(1);
  });

  it("falls back to org-wide row when repo row is absent (single query returns org row)", async () => {
    mocked.selectLimit.mockResolvedValueOnce([{ branches: ["trunk"] }]);

    const result = await getMainBranches(1, "everr-labs/everr");

    expect(result).toEqual(["trunk"]);
    expect(mocked.select).toHaveBeenCalledTimes(1);
  });

  it("falls back to defaults when the query returns no rows", async () => {
    mocked.selectLimit.mockResolvedValueOnce([]);

    const result = await getMainBranches(1, "everr-labs/everr");

    expect(result).toEqual([...DEFAULT_MAIN_BRANCHES]);
    expect(mocked.select).toHaveBeenCalledTimes(1);
  });
});

describe("getOrgMainBranches", () => {
  it("returns org-wide branches when an org row exists", async () => {
    mocked.selectLimit.mockResolvedValueOnce([{ branches: ["main", "dev"] }]);

    const result = await getOrgMainBranches(1);

    expect(result).toEqual(["main", "dev"]);
  });

  it("returns defaults when no org row exists", async () => {
    mocked.selectLimit.mockResolvedValueOnce([]);

    const result = await getOrgMainBranches(1);

    expect(result).toEqual([...DEFAULT_MAIN_BRANCHES]);
  });
});

describe("setRepoMainBranches", () => {
  it("calls insert with the correct values", async () => {
    mocked.insertOnConflictDoUpdate.mockResolvedValue(undefined);

    await setRepoMainBranches(1, "everr-labs/everr", ["main"]);

    expect(mocked.insert).toHaveBeenCalledTimes(1);
    expect(mocked.insertValues).toHaveBeenCalledWith({
      tenantId: 1,
      repository: "everr-labs/everr",
      branches: ["main"],
    });
    expect(mocked.insertOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({ branches: ["main"] }),
      }),
    );
  });

  it("throws when branches array is empty", async () => {
    await expect(
      setRepoMainBranches(1, "everr-labs/everr", []),
    ).rejects.toThrow("All branch names must be non-empty strings");

    expect(mocked.insert).not.toHaveBeenCalled();
  });
});

describe("setOrgMainBranches", () => {
  it("atomically upserts via insert + onConflictDoUpdate", async () => {
    mocked.insertOnConflictDoUpdate.mockResolvedValue(undefined);

    await setOrgMainBranches(1, ["main"]);

    expect(mocked.insert).toHaveBeenCalledTimes(1);
    expect(mocked.insertValues).toHaveBeenCalledWith({
      tenantId: 1,
      repository: null,
      branches: ["main"],
    });
    expect(mocked.insertOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({ branches: ["main"] }),
      }),
    );
    expect(mocked.select).not.toHaveBeenCalled();
  });

  it("throws when branches array is empty", async () => {
    await expect(setOrgMainBranches(1, [])).rejects.toThrow(
      "All branch names must be non-empty strings",
    );

    expect(mocked.select).not.toHaveBeenCalled();
    expect(mocked.insert).not.toHaveBeenCalled();
  });
});
