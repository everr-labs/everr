import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateReturning: vi.fn(),
  execute: vi.fn(),
  inserted: [] as Record<string, unknown>[],
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
  return {
    db: {
      transaction: (fn: (t: unknown) => unknown) => fn(tx),
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          mocks.inserted.push(values);
          return {
            returning: () =>
              Promise.resolve([
                {
                  ...values,
                  id: "5cbb1c68-5cc9-4444-8000-000000000001",
                  createdAt: new Date("2026-08-10T10:00:00Z"),
                  canceledAt: null,
                },
              ]),
          };
        },
      }),
    },
  };
});

import { SYSTEM_ACTOR } from "../session";
import { createSilence, expireSilence } from "./repository";

beforeEach(() => {
  mocks.updateReturning.mockReset();
  mocks.execute.mockReset().mockResolvedValue(undefined);
  mocks.inserted = [];
});

// The display is self-editable profile data: rename, create a silence, rename
// back, and the trail names the wrong person. The principal is the identity a
// rename cannot rewrite, and what ticket 17's audit attributes to.
it("stores the stable principal next to the display author", async () => {
  await createSilence(
    {
      organizationId: "org-1",
      actor: { kind: "user", id: "u1", display: "Alice" },
    },
    {
      matchers: [{ label: "team", op: "eq", value: "pay" }],
      starts_at: "2026-07-01T11:00:00Z",
      ends_at: "2026-07-01T13:00:00Z",
    },
  );

  expect(mocks.inserted[0]).toMatchObject({
    author: "Alice",
    authorPrincipal: "user:u1",
  });
});

it("releases the canceled silence's held events in one statement", async () => {
  mocks.updateReturning.mockResolvedValue([{ id: "sil-1" }]);

  await expect(
    expireSilence({ organizationId: "org-1", actor: SYSTEM_ACTOR }, "sil-1"),
  ).resolves.toEqual({
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

  await expect(
    expireSilence({ organizationId: "org-1", actor: SYSTEM_ACTOR }, "sil-1"),
  ).resolves.toEqual({
    expired: false,
  });
  expect(mocks.execute).not.toHaveBeenCalled();
});
