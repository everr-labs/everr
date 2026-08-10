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
import type { Transaction } from "@/db/client";
import { alertEvents } from "@/db/schema";
import {
  claimNotificationGroup,
  processAlertEvent,
  processedStampGuard,
} from "./process-event";
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

// FOR UPDATE cannot lock a row that does not exist yet, so two events
// creating the same group key race the insert. The loser must fold into the
// winner's row instead of failing its whole membership transaction onto a
// Graphile retry.
describe("claimNotificationGroup", () => {
  it("falls back to the winner's row when it loses the creation race", async () => {
    const now = new Date("2026-08-10T10:00:00Z");
    const winnerRow = {
      id: "5cbb1c68-5cc9-4444-8000-000000000001",
      nextFlushAt: new Date("2026-08-10T10:00:30Z"),
      lastFlushedAt: null,
    };
    // First pass: no row, insert conflicts. Second pass: the winner's row.
    const selects = [[], [winnerRow]];
    const updates: Record<string, unknown>[] = [];
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            for: () => ({ limit: () => Promise.resolve(selects.shift()) }),
          }),
        }),
      }),
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({ returning: () => Promise.resolve([]) }),
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          updates.push(values);
          return {
            where: () => ({
              returning: () => Promise.resolve([{ ...winnerRow, ...values }]),
            }),
          };
        },
      }),
    } as unknown as Transaction;

    const group = await claimNotificationGroup(
      tx,
      { organizationId: "org-1" },
      {
        groupKey: "direct:def-1",
        receiverId: null,
        directAlertDefinitionId: "def-1",
        groupLabels: {},
        groupWaitSeconds: 30,
        groupIntervalSeconds: 300,
        repeatIntervalSeconds: null,
      },
      now,
    );

    expect(group.id).toBe(winnerRow.id);
    expect(updates).toHaveLength(1);
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
