import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";

// ---------------------------------------------------------------------------
// Mock the db client with a chainable fluent builder.
// Individual tests configure `selectImpl` / `updateImpl` / `insertImpl` to
// return whatever data they need.
// ---------------------------------------------------------------------------

let selectImpl: () => unknown = () => undefined;
let updateImpl: () => unknown = () => ({ returning: () => [] });
let insertImpl: () => unknown = () => [{ slug: "aaaaaaaaaaaa" }];

vi.mock("@/db/client", () => {
  const selectChain = {
    from: vi.fn(() => selectChain),
    where: vi.fn(() => selectChain),
    limit: vi.fn(() => selectImpl()),
  };
  const updateChain = {
    set: vi.fn(() => updateChain),
    where: vi.fn(() => updateImpl()),
  };
  const insertChain = {
    values: vi.fn(() => insertChain),
    returning: vi.fn(() => insertImpl()),
  };
  return {
    db: {
      select: vi.fn(() => selectChain),
      update: vi.fn(() => updateChain),
      insert: vi.fn(() => insertChain),
    },
  };
});

vi.mock("@/db/schema", () => ({
  dashboardFolders: {
    id: "id",
    parentId: "parent_id",
    organizationId: "organization_id",
    name: "name",
    updatedAt: "updated_at",
  },
  dashboards: {
    id: "id",
    organizationId: "organization_id",
    slug: "slug",
    folderId: "folder_id",
    updatedAt: "updated_at",
    spec: "spec",
  },
}));

import {
  createDashboard,
  generateDashboardSlug,
  moveFolder,
  saveDashboard,
  updateDashboardSettings,
} from "./server";

const mockedDb = vi.mocked(db);

beforeEach(() => {
  vi.clearAllMocks();
  selectImpl = () => undefined;
  updateImpl = () => ({ returning: () => [] });
  insertImpl = () => [{ slug: "aaaaaaaaaaaa" }];
});

// ---------------------------------------------------------------------------
// Helper: configure the select chain to return a sequence of values.
// Each call to .limit() pops the next item from the queue.
// ---------------------------------------------------------------------------
function mockSelectSequence(rows: Array<unknown[] | undefined>) {
  const queue = [...rows];
  selectImpl = () => {
    return queue.shift() ?? undefined;
  };
}

describe("moveFolder – cycle check", () => {
  it("rejects when moving a folder into itself", async () => {
    // parentId === folderId → cycle detected before any db query
    await expect(
      moveFolder({ data: { folderId: "folder-a", parentId: "folder-a" } }),
    ).rejects.toThrow(
      "Cannot move a folder into itself or one of its subfolders",
    );
  });

  it("rejects when moving a folder into one of its own descendants", async () => {
    // Tree: folder-a → folder-b → folder-c (folder-c's ancestor chain reaches folder-a)
    // Moving folder-a into folder-c would create a cycle.
    // Ancestor walk from folder-c: folder-c → folder-b → folder-a (hit!)
    mockSelectSequence([
      // First lookup: folder-c's parent → folder-b
      [{ parentId: "folder-b" }],
      // Second lookup: folder-b's parent → folder-a  (= folderId → cycle!)
      [{ parentId: "folder-a" }],
    ]);

    await expect(
      moveFolder({ data: { folderId: "folder-a", parentId: "folder-c" } }),
    ).rejects.toThrow(
      "Cannot move a folder into itself or one of its subfolders",
    );
  });

  it("rejects when the target parent folder is not found", async () => {
    // The db returns no row for the first ancestor lookup.
    mockSelectSequence([
      // lookup for parentId returns empty array (folder not found)
      [],
    ]);

    await expect(
      moveFolder({ data: { folderId: "folder-a", parentId: "folder-x" } }),
    ).rejects.toThrow("Target folder not found");
  });

  it("resolves and issues the update for a valid move into an unrelated folder", async () => {
    // Tree: folder-b has no parent (parentId: null), so the walk terminates cleanly.
    mockSelectSequence([
      // lookup for folder-b → parentId: null
      [{ parentId: null }],
    ]);

    // update chain needs to return something (no .returning() needed here)
    updateImpl = () => undefined;

    const result = await moveFolder({
      data: { folderId: "folder-a", parentId: "folder-b" },
    });

    expect(result).toEqual({ id: "folder-a" });
    expect(mockedDb.update).toHaveBeenCalledTimes(1);
  });

  it("breaks out of the walk and does not loop infinitely if a pre-existing cycle exists in the db", async () => {
    // Simulate a pre-existing cycle: folder-x ↔ folder-y (neither is folder-a)
    // seen-set guard must prevent infinite loop.
    mockSelectSequence([
      // first: folder-x's parent → folder-y
      [{ parentId: "folder-y" }],
      // second: folder-y's parent → folder-x (cycle in db!)
      [{ parentId: "folder-x" }],
      // guard breaks before a third query
    ]);

    updateImpl = () => undefined;

    const result = await moveFolder({
      data: { folderId: "folder-a", parentId: "folder-x" },
    });

    expect(result).toEqual({ id: "folder-a" });
    // Only 2 select calls should have been made (not infinite)
    expect(mockedDb.select).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// generateDashboardSlug
// ---------------------------------------------------------------------------

describe("generateDashboardSlug", () => {
  it("produces a 12-character string matching /^[a-z0-9]{12}$/", () => {
    const slug = generateDashboardSlug();
    expect(slug).toMatch(/^[a-z0-9]{12}$/);
  });

  it("two consecutive calls produce different slugs (probabilistic)", () => {
    const a = generateDashboardSlug();
    const b = generateDashboardSlug();
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// saveDashboard – update-only behavior
// ---------------------------------------------------------------------------

describe("saveDashboard – update-only", () => {
  it("rejects with 'not found' when no matching row exists", async () => {
    // select returns an empty array → no existing dashboard
    selectImpl = () => [];

    await expect(
      saveDashboard({
        data: {
          slug: "some-slug",
          spec: { panels: {}, layouts: [] },
        },
      }),
    ).rejects.toThrow('Dashboard "some-slug" not found');

    // update must NOT have been called
    expect(mockedDb.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createDashboard – insert-only behavior
// ---------------------------------------------------------------------------

describe("createDashboard", () => {
  it("issues an insert and returns a slug matching the 12-char pattern", async () => {
    const fakeSlug = "ab3de6gh9012";
    insertImpl = () => [{ slug: fakeSlug }];

    const result = await createDashboard({
      data: { spec: { panels: {}, layouts: [] } },
    });

    expect(result.slug).toBe(fakeSlug);
    expect(result.slug).toMatch(/^[a-z0-9]{12}$/);

    // insert was called, update was not
    expect(mockedDb.insert).toHaveBeenCalledTimes(1);
    expect(mockedDb.update).not.toHaveBeenCalled();
  });
});

describe("updateDashboardSettings", () => {
  it("rejects when the dashboard is not found", async () => {
    selectImpl = () => [];
    await expect(
      updateDashboardSettings({
        data: { slug: "missing", duration: "1h" },
      }),
    ).rejects.toThrow('Dashboard "missing" not found');
    expect(mockedDb.update).not.toHaveBeenCalled();
  });

  it("sets duration and refreshInterval on the stored spec", async () => {
    selectImpl = () => [{ id: "dash-1", spec: { panels: {}, layouts: [] } }];
    updateImpl = () => undefined;

    await updateDashboardSettings({
      data: { slug: "abc", duration: "1h", refreshInterval: "30s" },
    });

    const chain = mockedDb.update.mock.results[0]!.value as {
      set: ReturnType<typeof vi.fn>;
    };
    const setArg = chain.set.mock.calls[0]![0] as {
      spec: Record<string, unknown>;
    };
    expect(setArg.spec.duration).toBe("1h");
    expect(setArg.spec.refreshInterval).toBe("30s");
  });

  it("removes duration and refreshInterval when omitted", async () => {
    selectImpl = () => [
      {
        id: "dash-1",
        spec: {
          panels: {},
          layouts: [],
          duration: "7d",
          refreshInterval: "5m",
        },
      },
    ];
    updateImpl = () => undefined;

    await updateDashboardSettings({ data: { slug: "abc" } });

    const chain = mockedDb.update.mock.results[0]!.value as {
      set: ReturnType<typeof vi.fn>;
    };
    const setArg = chain.set.mock.calls[0]![0] as {
      spec: Record<string, unknown>;
    };
    expect(setArg.spec).not.toHaveProperty("duration");
    expect(setArg.spec).not.toHaveProperty("refreshInterval");
  });
});
