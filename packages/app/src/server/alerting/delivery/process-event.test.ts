import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  // Consumed in call order: claimDeliverableEvent's own select first, then
  // (only on the branches that reach it) eventStillFiring's.
  selectQueue: [] as unknown[][],
  stampReturn: [] as { id: string }[],
  set: vi.fn(),
  update: vi.fn(),
  where: vi.fn(),
  history: [] as unknown[][],
}));

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mocks.selectQueue.shift() ?? []),
        }),
      }),
    }),
    update: mocks.update,
  },
  pool: {},
}));

vi.mock("../history/clickhouse", () => ({
  recordAlertHistory: (_defId: string | null, rows: unknown[]) => {
    mocks.history.push(rows);
    return Promise.resolve();
  },
  journalTerminalRow: (
    event: { id: string },
    opts: Record<string, unknown> = {},
  ) => ({ notificationEventId: event.id, ...opts }),
}));

import { QueryBuilder } from "drizzle-orm/pg-core";
import type { Transaction } from "@/db/client";
import { alertEvents } from "@/db/schema";
import {
  claimNotificationGroup,
  processAlertEvent,
  processedStampGuard,
} from "./process-event";

const EVENT_ID = "0ee52a7c-c9d7-4bca-9c67-a21db2096acf";

describe("processAlertEvent retention lifecycle", () => {
  beforeEach(() => {
    mocks.selectQueue = [];
    mocks.stampReturn = [{ id: EVENT_ID }];
    mocks.history = [];
    mocks.where
      .mockReset()
      .mockReturnValue({ returning: () => Promise.resolve(mocks.stampReturn) });
    mocks.set.mockReset().mockReturnValue({ where: mocks.where });
    mocks.update.mockReset().mockReturnValue({ set: mocks.set });
  });

  it("marks intentionally suppressed events as processed", async () => {
    mocks.selectQueue = [
      [{ id: EVENT_ID, processedAt: null, suppressed: true }],
    ];

    await processAlertEvent({ eventId: EVENT_ID });

    expect(mocks.set).toHaveBeenCalledWith({ processedAt: expect.any(Date) });
    expect(mocks.history).toEqual([]);
  });

  it("records a terminal when a fire is no longer firing by the time it is processed", async () => {
    mocks.selectQueue = [
      // claimDeliverableEvent's own read.
      [
        {
          id: EVENT_ID,
          processedAt: null,
          suppressed: false,
          eventType: "instance_fired",
          sourceDefinitionId: "def-1",
          instanceFingerprint: "fp-1",
          instanceLabels: {},
        },
      ],
      // eventStillFiring's firing-instance lookup: none found.
      [],
    ];

    await processAlertEvent({ eventId: EVENT_ID });

    expect(mocks.set).toHaveBeenCalledWith({ processedAt: expect.any(Date) });
    expect(mocks.history).toHaveLength(1);
    expect(mocks.history[0]).toEqual([
      expect.objectContaining({ reason: "no_longer_firing" }),
    ]);
  });

  it("records no terminal when the no-longer-firing claim is lost to a concurrent cancel", async () => {
    mocks.selectQueue = [
      [
        {
          id: EVENT_ID,
          processedAt: null,
          suppressed: false,
          eventType: "instance_fired",
          sourceDefinitionId: "def-1",
          instanceFingerprint: "fp-1",
          instanceLabels: {},
        },
      ],
      [],
    ];
    // The stamp write finds the event already claimed by a lifecycle cancel.
    mocks.stampReturn = [];

    await processAlertEvent({ eventId: EVENT_ID });

    expect(mocks.history).toEqual([]);
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
        defaultTier: null,
        directAlertDefinitionId: "def-1",
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
