import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  wheres: [] as unknown[],
  selectRows: [] as unknown[][],
  stampReturn: [] as { id: string }[],
  stampWheres: [] as unknown[],
  enqueued: [] as unknown[],
  history: [] as unknown[][],
}));

vi.mock("@/db/client", () => {
  const selectResult = () => {
    const rows = mocks.selectRows.shift() ?? [];
    return Object.assign(Promise.resolve(rows), {
      limit: () => Promise.resolve(rows),
    });
  };
  const where = (condition: unknown) => {
    mocks.wheres.push(condition);
    return selectResult();
  };
  const tx = {
    update: () => ({
      set: () => ({
        where: (condition: unknown) => {
          mocks.stampWheres.push(condition);
          return { returning: () => Promise.resolve(mocks.stampReturn) };
        },
      }),
    }),
  };
  return {
    db: {
      select: () => ({
        from: () => ({ where, innerJoin: () => ({ where }) }),
      }),
      transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    },
  };
});

vi.mock("@/data/alerting/delivery/tasks", () => ({
  enqueueProcessAlertEvent: (
    _tx: unknown,
    eventId: string,
    opts: Record<string, unknown>,
  ) => {
    mocks.enqueued.push({ eventId, ...opts });
    return Promise.resolve();
  },
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
  journalHoldRow: (event: { id: string }, silence: { id: string }) => ({
    notificationEventId: event.id,
    held: silence.id,
  }),
}));

import type { alertEvents } from "@/db/schema";
import { deferSuppressedEvent } from "./suppression";

beforeEach(() => {
  mocks.wheres = [];
  mocks.selectRows = [];
  mocks.stampReturn = [];
  mocks.stampWheres = [];
  mocks.enqueued = [];
  mocks.history = [];
});

describe("deferSuppressedEvent", () => {
  const now = new Date("2026-08-10T10:00:00Z");
  const silence = {
    id: "5cbb1c68-5cc9-4444-8000-000000000001",
    ends_at: "2026-08-10T11:00:00Z",
  } as unknown as NonNullable<Parameters<typeof deferSuppressedEvent>[1]>;
  const event = {
    id: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
    eventType: "instance_fired",
    organizationId: "org-1",
    sourceDefinitionId: "def-1",
    processedAt: null,
    instanceLabels: {},
  } as unknown as typeof alertEvents.$inferSelect;

  it("guards the stamp on the value it read and schedules the wake", async () => {
    mocks.selectRows = [[{ id: "inst-1" }]];
    mocks.stampReturn = [{ id: event.id }];

    await deferSuppressedEvent(event, silence, now);

    const stamp = new PgDialect().sqlToQuery(mocks.stampWheres[0] as SQL);
    expect(stamp.sql).toContain('"processed_at" is null');
    expect(mocks.enqueued).toEqual([
      {
        eventId: event.id,
        keySuffix: "2026-08-10T11:00:00.000Z",
        runAt: new Date(silence.ends_at),
      },
    ]);
    // The hold is recorded even though the notification is not decided: a
    // chain with a fire and nothing after it reads as a lost write.
    expect(mocks.history).toEqual([
      [{ notificationEventId: event.id, held: silence.id }],
    ]);
  });

  // A pause or delete stamped the event between this processor's read and its
  // write: the cancel's projection owns the terminal, so the defer must not
  // revive the event, schedule a wake, or record a second suppression row.
  it("does nothing when the claim was lost to a concurrent cancel", async () => {
    mocks.selectRows = [[{ id: "inst-1" }]];
    mocks.stampReturn = [];

    await deferSuppressedEvent(event, silence, now);

    expect(mocks.enqueued).toEqual([]);
    expect(mocks.history).toEqual([]);
  });

  // The flush path defers events whose processed_at is its own dispatch stamp;
  // the guard must match that exact value, not demand NULL.
  it("matches the dispatch stamp when the flush path defers", async () => {
    const dispatchStamp = new Date("2026-08-10T09:59:00Z");
    mocks.selectRows = [[]];
    mocks.stampReturn = [{ id: event.id }];

    await deferSuppressedEvent(
      { ...event, processedAt: dispatchStamp },
      silence,
      now,
    );

    const stamp = new PgDialect().sqlToQuery(mocks.stampWheres[0] as SQL);
    expect(stamp.sql).toContain('"processed_at" = ');
    expect(stamp.params).toContain(dispatchStamp.toISOString());
  });
});
