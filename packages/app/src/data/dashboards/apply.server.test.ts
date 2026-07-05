import { eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";

// ---------------------------------------------------------------------------
// Mock the db client with a chainable fluent builder. The reconciler runs on
// the executor passed in `opts.db` (the registry's transaction in production);
// tests pass this mocked `db` and override its `select` per-case via
// `mockApplySelect`. The registry — not the reconciler — owns the transaction,
// so writes are asserted directly on insert/update/delete.
// ---------------------------------------------------------------------------

let insertImpl: () => unknown = () => [{ slug: "aaaaaaaaaaaa" }];
let updateImpl: () => unknown = () => ({ returning: () => [] });
let deleteImpl: () => unknown = () => [];

vi.mock("@/db/client", () => {
  const selectChain = {
    from: vi.fn(() => selectChain),
    // Un-queued selects (e.g. the cross-repo conflict probe) resolve to no rows.
    where: vi.fn(() => Promise.resolve([])),
    limit: vi.fn(() => undefined),
  };
  const updateChain = {
    set: vi.fn(() => updateChain),
    where: vi.fn(() => updateImpl()),
  };
  const insertChain = {
    values: vi.fn(() => insertChain),
    returning: vi.fn(() => insertImpl()),
  };
  const deleteChain = {
    where: vi.fn(() => deleteImpl()),
  };
  return {
    db: {
      select: vi.fn(() => selectChain),
      update: vi.fn(() => updateChain),
      insert: vi.fn(() => insertChain),
      delete: vi.fn(() => deleteChain),
    },
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  ne: vi.fn((left: unknown, right: unknown) => ({ op: "ne", left, right })),
  or: vi.fn((...conditions: unknown[]) => ({ op: "or", conditions })),
  isNull: vi.fn((col: unknown) => ({ op: "isNull", col })),
  sql: vi.fn(() => ({ op: "sql" })),
}));

vi.mock("@/db/schema", () => ({
  dashboards: {
    id: "id",
    organizationId: "organization_id",
    repoid: "repoid",
    previewId: "preview_id",
    slug: "slug",
    project: "project",
    folderPath: "folder_path",
    updatedAt: "updated_at",
    document: "document",
  },
}));

import { applyDashboardSpecs } from "./apply.server";

const mockedDb = vi.mocked(db);

beforeEach(() => {
  vi.clearAllMocks();
  insertImpl = () => [{ slug: "aaaaaaaaaaaa" }];
  updateImpl = () => ({ returning: () => [] });
  deleteImpl = () => [];
});

function mockApplySelect(rows: unknown[]) {
  mockedDb.select.mockImplementationOnce(
    () =>
      ({
        from: () => ({
          where: () => Promise.resolve(rows),
        }),
      }) as unknown as ReturnType<typeof mockedDb.select>,
  );
}

const dash = (name: string, project?: string) => ({
  kind: "Dashboard",
  metadata: { name, ...(project ? { project } : {}) },
  spec: { panels: {}, layouts: [] },
});

// Shared executor + live-namespace default; each test overrides what it needs.
const live = { orgId: "org-1", repoid: "repo-1", kind: "live" } as const;
const base = { namespace: live, db };

describe("applyDashboardSpecs", () => {
  it("accepts a defaulted doc under the repo scope", async () => {
    mockApplySelect([]);
    const result = await applyDashboardSpecs({
      ...base,
      dryRun: true,
      resources: [{ path: "cpu.yaml", resource: dash("cpu") }],
    });
    expect(result.created).toEqual(["cpu"]);
  });

  it("prunes the last dashboard of a repo with no files", async () => {
    mockApplySelect([
      {
        project: "team",
        slug: "old",
        folderPath: "",
        document: dash("old", "team"),
      },
    ]);
    const result = await applyDashboardSpecs({
      ...base,
      dryRun: true,
      resources: [],
    });
    expect(result).toEqual({
      created: [],
      updated: [],
      deleted: ["old"],
      adopted: [],
      conflicts: [],
    });
  });

  it("prunes the stale side of a cross-project move", async () => {
    mockApplySelect([
      {
        project: "default",
        slug: "cpu",
        folderPath: "",
        document: dash("cpu", "default"),
      },
    ]);
    const result = await applyDashboardSpecs({
      ...base,
      dryRun: true,
      resources: [{ path: "cpu.yaml", resource: dash("cpu", "platform") }],
    });
    expect(result.created).toEqual(["cpu"]);
    expect(result.deleted).toEqual(["cpu"]);
  });

  it("scopes existing rows by repoid so same slugs in different repos do not collide", async () => {
    mockApplySelect([
      {
        project: "default",
        slug: "cpu",
        folderPath: "",
        document: dash("cpu"),
      },
    ]);
    const first = await applyDashboardSpecs({
      ...base,
      dryRun: true,
      resources: [{ path: "cpu.yaml", resource: dash("cpu") }],
    });

    mockApplySelect([]);
    const second = await applyDashboardSpecs({
      ...base,
      namespace: { orgId: "org-1", repoid: "repo-2", kind: "live" },
      dryRun: true,
      resources: [{ path: "cpu.yaml", resource: dash("cpu") }],
    });

    expect(first.deleted).toEqual([]);
    expect(second.created).toEqual(["cpu"]);
    expect(second.deleted).toEqual([]);
    expect(eq).toHaveBeenCalledWith("repoid", "repo-1");
    expect(eq).toHaveBeenCalledWith("repoid", "repo-2");
    // Live rows are scoped by a NULL preview_id, never the repoid alone.
    expect(isNull).toHaveBeenCalledWith("preview_id");
  });

  it("writes preview rows under previewId with a null repoid", async () => {
    mockApplySelect([]);
    const result = await applyDashboardSpecs({
      db,
      namespace: {
        orgId: "org-1",
        repoid: "repo-1",
        kind: "preview",
        id: "prev-1",
      },
      resources: [{ path: "cpu.yaml", resource: dash("cpu") }],
    });
    expect(result.created).toEqual(["cpu"]);
    // Preview rows hang off the registry id; repoid stays null (schema CHECK).
    expect(mockedDb.insert).toHaveBeenCalled();
    const insertChain = mockedDb.insert.mock.results[0]?.value as {
      values: ReturnType<typeof vi.fn>;
    };
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ previewId: "prev-1", repoid: null }),
    );
    // The preview scope keys off previewId, not (org, repoid, isNull).
    expect(eq).toHaveBeenCalledWith("preview_id", "prev-1");
  });

  it("writes the diff on the executor when not a dry run", async () => {
    mockApplySelect([]);
    const result = await applyDashboardSpecs({
      ...base,
      resources: [{ path: "a.yaml", resource: dash("a", "team") }],
    });
    expect(result.created).toEqual(["a"]);
    expect(mockedDb.insert).toHaveBeenCalledOnce();
    // Live creates carry the repoid and a null previewId (schema CHECK).
    const insertChain = mockedDb.insert.mock.results[0]?.value as {
      values: ReturnType<typeof vi.fn>;
    };
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ repoid: "repo-1", previewId: null }),
    );
  });

  it("rejects the apply when a document is invalid", async () => {
    await expect(
      applyDashboardSpecs({
        ...base,
        resources: [
          { path: "bad.yaml", resource: { kind: "Dashboard", spec: {} } },
        ],
      }),
    ).rejects.toThrow(/bad\.yaml/);
    expect(mockedDb.insert).not.toHaveBeenCalled();
  });

  it("reports a cross-repo conflict for a create whose identity another repo owns", async () => {
    mockApplySelect([]); // scope: no existing rows → cpu is a create
    // The foreign-owner probe finds repo-2 already owns default/cpu live.
    mockApplySelect([{ project: "default", slug: "cpu", owner: "repo-2" }]);
    const result = await applyDashboardSpecs({
      ...base,
      dryRun: true,
      resources: [{ path: "cpu.yaml", resource: dash("cpu") }],
    });
    expect(result.created).toEqual([]);
    expect(result.adopted).toEqual([]);
    expect(result.conflicts).toEqual([
      { project: "default", slug: "cpu", owner: "repo-2" },
    ]);
  });

  it("adopts a conflicting create, transferring ownership via an update", async () => {
    mockApplySelect([]); // scope
    mockApplySelect([{ project: "default", slug: "cpu", owner: "repo-2" }]);
    const result = await applyDashboardSpecs({
      ...base,
      adopt: true,
      resources: [{ path: "cpu.yaml", resource: dash("cpu") }],
    });
    expect(result.adopted).toEqual(["cpu"]);
    expect(result.conflicts).toEqual([]);
    expect(result.created).toEqual([]);
    // Ownership transfer is an update setting the new repoid, not an insert.
    expect(mockedDb.insert).not.toHaveBeenCalled();
    const updateChain = mockedDb.update.mock.results[0]?.value as {
      set: ReturnType<typeof vi.fn>;
    };
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ repoid: "repo-1" }),
    );
  });
});
