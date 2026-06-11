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

vi.mock("@/db/schema", () => ({
  notebooks: {
    id: "id",
    organizationId: "organization_id",
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
  it("creates from an empty store", async () => {
    mockApplySelect([]);
    const result = await applyNotebookSpecs({
      orgId: "org-1",
      projects: ["team"],
      documents: [{ path: "a.yaml", document: nb("a", "team") }],
    });
    expect(result.created).toEqual(["a"]);
    expect(result.dryRun).toBe(false);
    expect(mockedDb.transaction).toHaveBeenCalledOnce();
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
      projects: ["team"],
      documents: [{ path: "a.yaml", document: nb("a", "team", "# new") }],
    });
    expect(result).toMatchObject({
      created: [],
      updated: ["a"],
      deleted: [],
    });
  });

  it("prunes a notebook in a declared project with no files", async () => {
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
      projects: ["team"],
      dryRun: true,
      documents: [],
    });
    expect(result).toEqual({
      created: [],
      updated: [],
      deleted: ["old"],
      dryRun: true,
    });
  });

  it("rejects a doc whose project is not declared", async () => {
    await expect(
      applyNotebookSpecs({
        orgId: "org-1",
        projects: ["platform"],
        documents: [{ path: "cpu.yaml", document: nb("cpu") }], // -> "default"
      }),
    ).rejects.toThrow(/project "default".*not declared/i);
    expect(mockedDb.transaction).not.toHaveBeenCalled();
  });

  it("dryRun makes no writes", async () => {
    mockApplySelect([]);
    const result = await applyNotebookSpecs({
      orgId: "org-1",
      projects: ["team"],
      dryRun: true,
      documents: [{ path: "a.yaml", document: nb("a", "team") }],
    });
    expect(result.created).toEqual(["a"]);
    expect(result.dryRun).toBe(true);
    expect(mockedDb.transaction).not.toHaveBeenCalled();
  });
});
