import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";

const deleted: unknown[] = [];
let staleRows: unknown[] = [];
// The row `SELECT … FOR UPDATE` sees inside the transaction; null models a
// preview deleted since the scan, a fresh lastAppliedAt models a concurrent
// re-apply.
let lockedRows: unknown[] = [];

vi.mock("@/db/client", () => {
  const insertChain = {
    values: vi.fn(() => insertChain),
    onConflictDoUpdate: vi.fn(() => Promise.resolve()),
  };
  const deleteChain = (tableRef: unknown) => ({
    where: vi.fn((cond: unknown) => {
      deleted.push({ table: tableRef, cond });
      return Promise.resolve();
    }),
  });
  const lockChain = {
    from: vi.fn(() => lockChain),
    where: vi.fn(() => lockChain),
    for: vi.fn(() => Promise.resolve(lockedRows)),
  };
  return {
    db: {
      insert: vi.fn(() => insertChain),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(staleRows)),
        })),
      })),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          select: vi.fn(() => lockChain),
          delete: vi.fn((t: unknown) => deleteChain(t)),
        }),
      ),
    },
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  lt: vi.fn((left: unknown, right: unknown) => ({ op: "lt", left, right })),
}));

vi.mock("@/db/schema", () => ({
  dashboards: {
    organizationId: "d.org",
    repoid: "d.repo",
    preview: "d.preview",
  },
  runbooks: { organizationId: "r.org", repoid: "r.repo", preview: "r.preview" },
  alertDefinitions: {
    organizationId: "a.org",
    repoid: "a.repo",
    preview: "a.preview",
  },
  previews: {
    organizationId: "p.org",
    repoid: "p.repo",
    name: "p.name",
    lastAppliedAt: "p.last_applied_at",
  },
}));

import { deleteStalePreviews, upsertPreview } from "./apply.server";

const mockedDb = vi.mocked(db);

beforeEach(() => {
  vi.clearAllMocks();
  deleted.length = 0;
  staleRows = [];
  lockedRows = [];
});

describe("upsertPreview", () => {
  it("inserts with conflict-update on lastAppliedAt", async () => {
    await upsertPreview({ orgId: "org-1", repoid: "repo-1", name: "gio/x" });
    expect(mockedDb.insert).toHaveBeenCalledTimes(1);
  });
});

describe("deleteStalePreviews", () => {
  it("deletes nothing when no previews are stale", async () => {
    expect(await deleteStalePreviews(7)).toBe(0);
    expect(deleted).toHaveLength(0);
  });

  it("deletes resource rows and the registry row per stale preview", async () => {
    staleRows = [{ organizationId: "org-1", repoid: "repo-1", name: "gio/x" }];
    lockedRows = [{ lastAppliedAt: new Date(0) }];
    expect(await deleteStalePreviews(7)).toBe(1);
    // dashboards, runbooks, alertDefinitions, previews — one delete each.
    expect(deleted).toHaveLength(4);
    expect(mockedDb.transaction).toHaveBeenCalledTimes(1);
  });

  it("skips a preview re-applied since the scan (locked row is now fresh)", async () => {
    staleRows = [{ organizationId: "org-1", repoid: "repo-1", name: "gio/x" }];
    lockedRows = [{ lastAppliedAt: new Date() }];
    expect(await deleteStalePreviews(7)).toBe(0);
    expect(deleted).toHaveLength(0);
  });

  it("skips a preview deleted since the scan (locked row is gone)", async () => {
    staleRows = [{ organizationId: "org-1", repoid: "repo-1", name: "gio/x" }];
    lockedRows = [];
    expect(await deleteStalePreviews(7)).toBe(0);
    expect(deleted).toHaveLength(0);
  });
});
