import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";

// ---------------------------------------------------------------------------
// Mock the db client with a chainable fluent builder.
// applyNotebookSpecs ends the read chain at .where() (not .limit()), so tests
// override db.select per-case via `mockApplySelect`.
// ---------------------------------------------------------------------------

let insertImpl: () => unknown = () => [{ slug: "aaaaaaaaaaaa" }];
let updateImpl: () => unknown = () => ({ returning: () => [] });
let deleteImpl: () => unknown = () => [];

vi.mock("@/db/client", () => {
  const selectChain = {
    from: vi.fn(() => selectChain),
    where: vi.fn(() => selectChain),
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
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          insert: vi.fn(() => insertChain),
          update: vi.fn(() => updateChain),
          delete: vi.fn(() => deleteChain),
        }),
      ),
    },
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
}));

vi.mock("@/db/schema", () => ({
  notebooks: {
    id: "id",
    organizationId: "organization_id",
    repoid: "repoid",
    slug: "slug",
    project: "project",
    folderPath: "folder_path",
    updatedAt: "updated_at",
    document: "document",
  },
}));

import { applyNotebookSpecs } from "./apply.server";

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
  kind: "Notebook",
  metadata: { name, ...(project ? { project } : {}) },
  spec: { markdown: { inline } },
});

describe("applyNotebookSpecs", () => {
  it("accepts a defaulted doc under the repo scope", async () => {
    mockApplySelect([]);
    const result = await applyNotebookSpecs({
      orgId: "org-1",
      repoid: "repo-1",
      dryRun: true,
      resources: [{ path: "a.yaml", resource: nb("a") }],
    });
    expect(result.created).toEqual(["a"]);
  });

  it("updates a notebook whose document changed", async () => {
    mockApplySelect([
      {
        project: "team",
        slug: "a",
        folderPath: "",
        document: nb("a", "team", "# old"),
      },
    ]);
    const result = await applyNotebookSpecs({
      orgId: "org-1",
      repoid: "repo-1",
      resources: [{ path: "a.yaml", resource: nb("a", "team", "# new") }],
    });
    expect(result).toMatchObject({
      created: [],
      updated: ["a"],
      deleted: [],
    });
  });

  it("prunes the last notebook of a repo with no files", async () => {
    mockApplySelect([
      {
        project: "team",
        slug: "old",
        folderPath: "",
        document: nb("old", "team"),
      },
    ]);
    const result = await applyNotebookSpecs({
      orgId: "org-1",
      repoid: "repo-1",
      dryRun: true,
      resources: [],
    });
    expect(result).toEqual({
      created: [],
      updated: [],
      deleted: ["old"],
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
    const first = await applyNotebookSpecs({
      orgId: "org-1",
      repoid: "repo-1",
      dryRun: true,
      resources: [{ path: "a.yaml", resource: nb("a") }],
    });

    mockApplySelect([]);
    const second = await applyNotebookSpecs({
      orgId: "org-1",
      repoid: "repo-2",
      dryRun: true,
      resources: [{ path: "a.yaml", resource: nb("a") }],
    });

    expect(first.deleted).toEqual([]);
    expect(second.created).toEqual(["a"]);
    expect(second.deleted).toEqual([]);
    expect(eq).toHaveBeenCalledWith("repoid", "repo-1");
    expect(eq).toHaveBeenCalledWith("repoid", "repo-2");
  });

  it("applies the diff inside a transaction when not a dry run", async () => {
    mockApplySelect([]);
    const result = await applyNotebookSpecs({
      orgId: "org-1",
      repoid: "repo-1",
      resources: [{ path: "a.yaml", resource: nb("a", "team") }],
    });
    expect(result.created).toEqual(["a"]);
    expect(mockedDb.transaction).toHaveBeenCalledOnce();
  });

  it("dryRun makes no writes", async () => {
    mockApplySelect([]);
    const result = await applyNotebookSpecs({
      orgId: "org-1",
      repoid: "repo-1",
      dryRun: true,
      resources: [{ path: "a.yaml", resource: nb("a", "team") }],
    });
    expect(result.created).toEqual(["a"]);
    expect(mockedDb.transaction).not.toHaveBeenCalled();
  });

  it("rejects the apply when a document is invalid", async () => {
    await expect(
      applyNotebookSpecs({
        orgId: "org-1",
        repoid: "repo-1",
        resources: [
          { path: "bad.yaml", resource: { kind: "Notebook", spec: {} } },
        ],
      }),
    ).rejects.toThrow(/bad\.yaml/);
    expect(mockedDb.transaction).not.toHaveBeenCalled();
  });
});
