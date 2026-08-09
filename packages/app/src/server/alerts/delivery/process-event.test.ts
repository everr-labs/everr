import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
  set: vi.fn(),
  update: vi.fn(),
  where: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mocks.rows),
        }),
      }),
    }),
    update: mocks.update,
  },
  pool: {},
}));

import { QueryBuilder } from "drizzle-orm/pg-core";
import { alertEvents } from "@/db/schema";
import { processAlertEvent, processedStampGuard } from "./process-event";
import { selectDispatchTargets } from "./targeting";

describe("notification destination precedence", () => {
  it("uses an explicit destination without resolving advanced routes", async () => {
    const routedTargets = vi.fn().mockResolvedValue(["advanced"]);

    await expect(
      selectDispatchTargets("direct", routedTargets),
    ).resolves.toEqual(["direct"]);
    expect(routedTargets).not.toHaveBeenCalled();
  });

  it("falls back to advanced routes when no destination is explicit", async () => {
    const routedTargets = vi.fn().mockResolvedValue(["advanced"]);

    await expect(selectDispatchTargets(null, routedTargets)).resolves.toEqual([
      "advanced",
    ]);
    expect(routedTargets).toHaveBeenCalledOnce();
  });
});

describe("processAlertEvent retention lifecycle", () => {
  beforeEach(() => {
    mocks.rows = [];
    mocks.where.mockReset().mockResolvedValue(undefined);
    mocks.set.mockReset().mockReturnValue({ where: mocks.where });
    mocks.update.mockReset().mockReturnValue({ set: mocks.set });
  });

  it("marks intentionally suppressed events as processed", async () => {
    mocks.rows = [
      {
        id: "0ee52a7c-c9d7-4bca-9c67-a21db2096acf",
        processedAt: null,
        suppressed: true,
      },
    ];

    await processAlertEvent({
      eventId: "0ee52a7c-c9d7-4bca-9c67-a21db2096acf",
    });

    expect(mocks.set).toHaveBeenCalledWith({ processedAt: expect.any(Date) });
  });

  it("does not process an event twice after completion", async () => {
    mocks.rows = [
      {
        id: "0ee52a7c-c9d7-4bca-9c67-a21db2096acf",
        processedAt: new Date("2026-08-06T12:00:00Z"),
        suppressed: false,
      },
    ];

    await processAlertEvent({
      eventId: "0ee52a7c-c9d7-4bca-9c67-a21db2096acf",
    });

    expect(mocks.update).not.toHaveBeenCalled();
  });
});

// The stamp is the dispatch's claim against a concurrent lifecycle cancel;
// without the null guard both sides own the event and its chain gets two
// terminals.
describe("processedStampGuard", () => {
  it("claims the event only while it is unprocessed", () => {
    const { sql, params } = new QueryBuilder()
      .select()
      .from(alertEvents)
      .where(processedStampGuard("0ee52a7c-c9d7-4bca-9c67-a21db2096acf"))
      .toSQL();

    expect(sql).toContain('"id" = ');
    expect(sql).toContain('"processed_at" is null');
    expect(params).toEqual(["0ee52a7c-c9d7-4bca-9c67-a21db2096acf"]);
  });
});
