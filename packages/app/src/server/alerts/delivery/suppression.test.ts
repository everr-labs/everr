import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  wheres: [] as unknown[],
}));

vi.mock("@/db/client", () => {
  const where = (condition: unknown) => {
    mocks.wheres.push(condition);
    return Promise.resolve([]);
  };
  return {
    db: {
      select: () => ({
        from: () => ({ where, innerJoin: () => ({ where }) }),
      }),
    },
  };
});

import type { alertEvents } from "@/db/schema";
import { isInhibited } from "./suppression";

it("draws inhibition sources only from the event's own world", async () => {
  const event = {
    eventType: "instance_fired",
    organizationId: "org-1",
    previewId: "prev-1",
    sourceDefinitionId: "def-1",
    severity: "critical",
    instanceLabels: {},
  } as unknown as typeof alertEvents.$inferSelect;

  await expect(isInhibited(event)).resolves.toBe(false);

  const sources = new PgDialect().sqlToQuery(mocks.wheres[1] as SQL);
  expect(sources.sql).toContain('"preview_id" IS NOT DISTINCT FROM');
  expect(sources.params).toContain("prev-1");
});
