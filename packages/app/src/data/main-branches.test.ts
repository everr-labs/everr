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
  const selectWhere = vi.fn(() => ({
    limit: selectLimit,
  }));
  const selectFrom = vi.fn(() => ({
    where: selectWhere,
  }));
  const select = vi.fn(() => ({
    from: selectFrom,
  }));

  const updateWhere = vi.fn();
  const updateSet = vi.fn(() => ({
    where: updateWhere,
  }));
  const update = vi.fn(() => ({
    set: updateSet,
  }));

  return {
    insert,
    insertValues,
    insertOnConflictDoUpdate,
    select,
    selectLimit,
    update,
    updateSet,
    updateWhere,
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn(() => "and_clause"),
  eq: vi.fn(() => "eq_clause"),
  isNull: vi.fn(() => "is_null_clause"),
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
    update: mocked.update,
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
  it("returns repo-specific branches when a repo row exists", async () => {
    mocked.selectLimit.mockResolvedValueOnce([
      { branches: ["main", "release"] },
    ]);

    const result = await getMainBranches(1, "everr-labs/everr");

    expect(result).toEqual(["main", "release"]);
    expect(mocked.select).toHaveBeenCalledTimes(1);
  });

  it("falls back to org-wide row when no repo row exists", async () => {
    mocked.selectLimit
      .mockResolvedValueOnce([]) // no repo row
      .mockResolvedValueOnce([{ branches: ["trunk"] }]); // org row

    const result = await getMainBranches(1, "everr-labs/everr");

    expect(result).toEqual(["trunk"]);
    expect(mocked.select).toHaveBeenCalledTimes(2);
  });

  it("falls back to defaults when neither repo nor org rows exist", async () => {
    mocked.selectLimit
      .mockResolvedValueOnce([]) // no repo row
      .mockResolvedValueOnce([]); // no org row

    const result = await getMainBranches(1, "everr-labs/everr");

    expect(result).toEqual([...DEFAULT_MAIN_BRANCHES]);
    expect(mocked.select).toHaveBeenCalledTimes(2);
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
    ).rejects.toThrow("At least one branch is required");

    expect(mocked.insert).not.toHaveBeenCalled();
  });
});

describe("setOrgMainBranches", () => {
  it("updates existing org row when one already exists", async () => {
    mocked.selectLimit.mockResolvedValueOnce([{ id: 42 }]);
    mocked.updateWhere.mockResolvedValue(undefined);

    await setOrgMainBranches(1, ["main"]);

    expect(mocked.update).toHaveBeenCalledTimes(1);
    expect(mocked.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ branches: ["main"] }),
    );
    expect(mocked.updateWhere).toHaveBeenCalledTimes(1);
    expect(mocked.insert).not.toHaveBeenCalled();
  });

  it("inserts a new row when no org row exists", async () => {
    mocked.selectLimit.mockResolvedValueOnce([]);
    mocked.insertValues.mockReturnValue(undefined);

    await setOrgMainBranches(1, ["main"]);

    expect(mocked.insert).toHaveBeenCalledTimes(1);
    expect(mocked.insertValues).toHaveBeenCalledWith({
      tenantId: 1,
      repository: null,
      branches: ["main"],
    });
    expect(mocked.update).not.toHaveBeenCalled();
  });

  it("throws when branches array is empty", async () => {
    await expect(setOrgMainBranches(1, [])).rejects.toThrow(
      "At least one branch is required",
    );

    expect(mocked.select).not.toHaveBeenCalled();
    expect(mocked.insert).not.toHaveBeenCalled();
  });
});
