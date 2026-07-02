import { eq } from "drizzle-orm";
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

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
}));

vi.mock("@/db/schema", () => ({
  dashboards: {
    id: "id",
    organizationId: "organization_id",
    repoid: "repoid",
    preview: "preview",
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

describe("applyDashboardSpecs", () => {
  it("accepts a defaulted doc under the repo scope", async () => {
    mockApplySelect([]);
    const result = await applyDashboardSpecs({
      orgId: "org-1",
      repoid: "repo-1",
      preview: "",
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
      orgId: "org-1",
      repoid: "repo-1",
      preview: "",
      dryRun: true,
      resources: [],
    });
    expect(result).toEqual({
      created: [],
      updated: [],
      deleted: ["old"],
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
      orgId: "org-1",
      repoid: "repo-1",
      preview: "",
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
      orgId: "org-1",
      repoid: "repo-1",
      preview: "",
      dryRun: true,
      resources: [{ path: "cpu.yaml", resource: dash("cpu") }],
    });

    mockApplySelect([]);
    const second = await applyDashboardSpecs({
      orgId: "org-1",
      repoid: "repo-2",
      preview: "",
      dryRun: true,
      resources: [{ path: "cpu.yaml", resource: dash("cpu") }],
    });

    expect(first.deleted).toEqual([]);
    expect(second.created).toEqual(["cpu"]);
    expect(second.deleted).toEqual([]);
    expect(eq).toHaveBeenCalledWith("repoid", "repo-1");
    expect(eq).toHaveBeenCalledWith("repoid", "repo-2");
  });

  it("applies the diff inside a transaction when not a dry run", async () => {
    mockApplySelect([]);
    const result = await applyDashboardSpecs({
      orgId: "org-1",
      repoid: "repo-1",
      preview: "",
      resources: [{ path: "a.yaml", resource: dash("a", "team") }],
    });
    expect(result.created).toEqual(["a"]);
    expect(mockedDb.transaction).toHaveBeenCalledOnce();
  });

  it("rejects the apply when a document is invalid", async () => {
    await expect(
      applyDashboardSpecs({
        orgId: "org-1",
        repoid: "repo-1",
        preview: "",
        resources: [
          { path: "bad.yaml", resource: { kind: "Dashboard", spec: {} } },
        ],
      }),
    ).rejects.toThrow(/bad\.yaml/);
    expect(mockedDb.transaction).not.toHaveBeenCalled();
  });
});
