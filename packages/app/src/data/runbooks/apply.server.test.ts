import { eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";

// ---------------------------------------------------------------------------
// Mock the db client with a chainable fluent builder. The reconciler runs on
// the executor passed in `opts.db` (the registry's transaction in production);
// tests pass this mocked `db` and override its `select` per-case via
// `mockApplySelect`. Writes are asserted directly on insert/update/delete since
// the registry — not the reconciler — owns the transaction.
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
  runbooks: {
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

import { applyRunbookSpecs } from "./apply.server";

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

const nb = (name: string, project?: string, inline = "# x") => ({
  kind: "Runbook",
  metadata: { name, ...(project ? { project } : {}) },
  spec: { markdown: { inline } },
});

// Shared executor + live-namespace defaults; each test overrides what it needs.
const live = { orgId: "org-1", repoid: "repo-1", kind: "live" } as const;
const base = { namespace: live, db };

describe("applyRunbookSpecs", () => {
  it("accepts a defaulted doc under the repo scope", async () => {
    mockApplySelect([]);
    const result = await applyRunbookSpecs({
      ...base,
      dryRun: true,
      resources: [{ path: "a.yaml", resource: nb("a") }],
    });
    expect(result.created).toEqual(["a"]);
  });

  it("updates a runbook whose document changed", async () => {
    mockApplySelect([
      {
        project: "team",
        slug: "a",
        folderPath: "",
        document: nb("a", "team", "# old"),
      },
    ]);
    const result = await applyRunbookSpecs({
      ...base,
      resources: [{ path: "a.yaml", resource: nb("a", "team", "# new") }],
    });
    expect(result).toMatchObject({
      created: [],
      updated: ["a"],
      deleted: [],
    });
  });

  it("prunes the last runbook of a repo with no files", async () => {
    mockApplySelect([
      {
        project: "team",
        slug: "old",
        folderPath: "",
        document: nb("old", "team"),
      },
    ]);
    const result = await applyRunbookSpecs({
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
      warnings: [],
    });
  });

  it("scopes existing rows by repoid so same slugs in different repos do not collide", async () => {
    mockApplySelect([
      {
        project: "default",
        slug: "a",
        folderPath: "",
        document: nb("a"),
      },
    ]);
    const first = await applyRunbookSpecs({
      ...base,
      dryRun: true,
      resources: [{ path: "a.yaml", resource: nb("a") }],
    });

    mockApplySelect([]);
    const second = await applyRunbookSpecs({
      ...base,
      namespace: { orgId: "org-1", repoid: "repo-2", kind: "live" },
      dryRun: true,
      resources: [{ path: "a.yaml", resource: nb("a") }],
    });

    expect(first.deleted).toEqual([]);
    expect(second.created).toEqual(["a"]);
    expect(second.deleted).toEqual([]);
    expect(eq).toHaveBeenCalledWith("repoid", "repo-1");
    expect(eq).toHaveBeenCalledWith("repoid", "repo-2");
    // Live rows are scoped by a NULL preview_id, never the repoid alone.
    expect(isNull).toHaveBeenCalledWith("preview_id");
  });

  it("writes the diff on the executor when not a dry run", async () => {
    mockApplySelect([]);
    const result = await applyRunbookSpecs({
      ...base,
      resources: [{ path: "a.yaml", resource: nb("a", "team") }],
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

  it("dryRun makes no writes", async () => {
    mockApplySelect([]);
    const result = await applyRunbookSpecs({
      ...base,
      dryRun: true,
      resources: [{ path: "a.yaml", resource: nb("a", "team") }],
    });
    expect(result.created).toEqual(["a"]);
    expect(mockedDb.insert).not.toHaveBeenCalled();
  });

  it("rejects the apply when a document is invalid", async () => {
    await expect(
      applyRunbookSpecs({
        ...base,
        resources: [
          { path: "bad.yaml", resource: { kind: "Runbook", spec: {} } },
        ],
      }),
    ).rejects.toThrow(/bad\.yaml/);
    expect(mockedDb.insert).not.toHaveBeenCalled();
  });

  it("scopes preview inserts to the registry id with a null repoid", async () => {
    insertImpl = () => [{ slug: "a" }];
    mockApplySelect([]);
    const result = await applyRunbookSpecs({
      db,
      namespace: {
        orgId: "org-1",
        repoid: "repo-1",
        kind: "preview",
        id: "prev-1",
      },
      resources: [{ path: "a.yaml", resource: nb("a") }],
    });
    expect(result.created).toEqual(["a"]);
    // The existing-rows query and writes scope by the registry id.
    const eqCalls = vi.mocked(eq).mock.calls.map(([l, r]) => [l, r]);
    expect(eqCalls).toContainEqual(["preview_id", "prev-1"]);
    const insertChain = mockedDb.insert.mock.results[0]?.value as {
      values: ReturnType<typeof vi.fn>;
    };
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ previewId: "prev-1", repoid: null }),
    );
  });
});
