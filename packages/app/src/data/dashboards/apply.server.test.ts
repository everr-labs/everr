import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";

// ---------------------------------------------------------------------------
// Mock the db client with a chainable fluent builder.
// applyDashboardSpecs ends the read chain at .where() (not .limit()), so tests
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
  dashboards: {
    id: "id",
    organizationId: "organization_id",
    slug: "slug",
    project: "project",
    folderPath: "folder_path",
    updatedAt: "updated_at",
    spec: "spec",
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

describe("applyDashboardSpecs", () => {
  it("dryRun diffs against existing rows in the run's projects and does not write", async () => {
    mockApplySelect([
      {
        project: "default",
        slug: "old-dash",
        folderPath: "",
        document: dash("old-dash"),
      },
    ]);
    const result = await applyDashboardSpecs({
      orgId: "org-1",
      dryRun: true,
      documents: [{ path: "cpu.yaml", document: dash("cpu") }],
    });
    expect(result).toEqual({
      created: ["cpu"],
      updated: [],
      deleted: ["old-dash"],
      dryRun: true,
    });
    expect(mockedDb.transaction).not.toHaveBeenCalled();
  });

  it("does not prune a project absent from the run", async () => {
    mockApplySelect([]);
    const result = await applyDashboardSpecs({
      orgId: "org-1",
      dryRun: true,
      documents: [],
    });
    expect(result.deleted).toEqual([]);
    expect(result.created).toEqual([]);
  });

  it("applies the diff inside a transaction when not a dry run", async () => {
    mockApplySelect([]);
    const result = await applyDashboardSpecs({
      orgId: "org-1",
      documents: [{ path: "a.yaml", document: dash("a", "team") }],
    });
    expect(result.created).toEqual(["a"]);
    expect(result.dryRun).toBe(false);
    expect(mockedDb.transaction).toHaveBeenCalledOnce();
  });

  it("rejects the apply when a document is invalid", async () => {
    await expect(
      applyDashboardSpecs({
        orgId: "org-1",
        documents: [
          { path: "bad.yaml", document: { kind: "Dashboard", spec: {} } },
        ],
      }),
    ).rejects.toThrow(/bad\.yaml/);
    expect(mockedDb.transaction).not.toHaveBeenCalled();
  });
});
