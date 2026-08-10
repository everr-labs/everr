import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateReturning: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/db/client", () => {
  const tx = {
    update: () => ({
      set: () => ({
        where: () => ({ returning: mocks.updateReturning }),
      }),
    }),
    execute: mocks.execute,
  };
  return { db: { transaction: (fn: (t: unknown) => unknown) => fn(tx) } };
});

import { expireSilence } from "./repository";

beforeEach(() => {
  mocks.updateReturning.mockReset();
  mocks.execute.mockReset().mockResolvedValue(undefined);
});

it("releases the canceled silence's held events in one statement", async () => {
  mocks.updateReturning.mockResolvedValue([{ id: "sil-1" }]);

  await expect(expireSilence("org-1", "sil-1")).resolves.toEqual({
    expired: true,
  });

  const query = new PgDialect().sqlToQuery(
    mocks.execute.mock.calls[0]?.[0] as SQL,
  );
  expect(query.sql).toContain("graphile_worker.add_job");
  expect(query.sql).toContain(":release");
  expect(query.sql).toContain("IS NULL");
  expect(query.params).toContain("sil-1");
  expect(query.params).toContain("org-1");
});

it("enqueues nothing when the silence was already closed", async () => {
  mocks.updateReturning.mockResolvedValue([]);

  await expect(expireSilence("org-1", "sil-1")).resolves.toEqual({
    expired: false,
  });
  expect(mocks.execute).not.toHaveBeenCalled();
});
