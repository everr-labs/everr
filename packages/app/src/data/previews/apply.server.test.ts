import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";

// Rows the mocked `returning()`/`limit()` resolve to; set per-test.
let deletedRows: { id: string }[] = [];
let findRows: { id: string }[] = [];

vi.mock("@/db/client", () => {
  const insertChain = {
    values: vi.fn(() => insertChain),
    onConflictDoUpdate: vi.fn(() => insertChain),
    returning: vi.fn(() => Promise.resolve([{ id: "prev-1" }])),
  };
  const selectChain = {
    from: vi.fn(() => selectChain),
    where: vi.fn(() => selectChain),
    limit: vi.fn(() => Promise.resolve(findRows)),
  };
  const deleteChain = {
    where: vi.fn(() => deleteChain),
    returning: vi.fn(() => Promise.resolve(deletedRows)),
  };
  return {
    db: {
      insert: vi.fn(() => insertChain),
      select: vi.fn(() => selectChain),
      delete: vi.fn(() => deleteChain),
    },
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  lt: vi.fn((left: unknown, right: unknown) => ({ op: "lt", left, right })),
}));

vi.mock("@/db/schema", () => ({
  previews: {
    id: "p.id",
    organizationId: "p.org",
    repoid: "p.repo",
    name: "p.name",
    lastAppliedAt: "p.last_applied_at",
  },
}));

import {
  deleteStalePreviews,
  findPreviewId,
  upsertPreview,
} from "./apply.server";

const mockedDb = vi.mocked(db);

beforeEach(() => {
  vi.clearAllMocks();
  deletedRows = [];
  findRows = [];
});

describe("upsertPreview", () => {
  it("inserts with conflict-update and returns the row id", async () => {
    const id = await upsertPreview(db, {
      orgId: "org-1",
      repoid: "repo-1",
      name: "gio/x",
    });
    expect(id).toBe("prev-1");
    expect(mockedDb.insert).toHaveBeenCalledTimes(1);
  });
});

describe("findPreviewId", () => {
  it("returns the id when the preview exists", async () => {
    findRows = [{ id: "prev-9" }];
    expect(
      await findPreviewId(db, { orgId: "o", repoid: "r", name: "gio/x" }),
    ).toBe("prev-9");
  });

  it("returns null when no row matches", async () => {
    findRows = [];
    expect(
      await findPreviewId(db, { orgId: "o", repoid: "r", name: "gio/x" }),
    ).toBeNull();
  });
});

describe("deleteStalePreviews", () => {
  it("returns 0 when nothing is stale", async () => {
    expect(await deleteStalePreviews(7)).toBe(0);
    expect(mockedDb.delete).toHaveBeenCalledTimes(1);
  });

  it("counts the stale registry rows removed (resources cascade)", async () => {
    deletedRows = [{ id: "a" }, { id: "b" }];
    expect(await deleteStalePreviews(7)).toBe(2);
    // One predicated delete on previews; the FK cascade removes resource rows.
    expect(mockedDb.delete).toHaveBeenCalledTimes(1);
  });
});
