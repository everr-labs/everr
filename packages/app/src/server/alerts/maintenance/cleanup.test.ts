import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    transaction: mocks.transaction,
  },
}));

import { cleanupAlertingHistory } from "./cleanup";

const dialect = new PgDialect();

function sqlText(query: unknown): string {
  return dialect.sqlToQuery(query as Parameters<PgDialect["sqlToQuery"]>[0])
    .sql;
}

describe("cleanupAlertingHistory", () => {
  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.transaction.mockReset().mockImplementation(async (callback) =>
      callback({
        execute: mocks.execute,
      }),
    );
  });

  it("deletes bounded history and reports each table", async () => {
    for (const rowCount of [11, 12, 13, 14, 15, 16]) {
      mocks.execute.mockResolvedValueOnce({ rowCount });
    }

    await expect(
      cleanupAlertingHistory({
        now: new Date("2026-08-06T12:00:00Z"),
        batchSize: 100,
        maxBatches: 3,
      }),
    ).resolves.toEqual({
      alertEvaluations: 11,
      events: 12,
      deliveries: 13,
      notificationGroups: 14,
      silences: 15,
      instances: 16,
    });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledTimes(6);
  });

  it("keeps running full batches but respects the per-run cap", async () => {
    mocks.execute.mockResolvedValue({ rowCount: 2 });

    await expect(
      cleanupAlertingHistory({
        now: new Date("2026-08-06T12:00:00Z"),
        batchSize: 2,
        maxBatches: 3,
      }),
    ).resolves.toEqual({
      alertEvaluations: 6,
      events: 6,
      deliveries: 6,
      notificationGroups: 6,
      silences: 6,
      instances: 6,
    });
    expect(mocks.transaction).toHaveBeenCalledTimes(3);
    expect(mocks.execute).toHaveBeenCalledTimes(18);
  });

  it("protects unfinished events, active groups, and delivery history", async () => {
    mocks.execute.mockResolvedValue({ rowCount: 0 });

    await cleanupAlertingHistory({
      now: new Date("2026-08-06T12:00:00Z"),
      batchSize: 100,
      maxBatches: 1,
    });

    const eventDelete = sqlText(mocks.execute.mock.calls[1][0]);
    expect(eventDelete).toContain("event.processed_at <");
    expect(eventDelete).toContain("alert_notification_group_events");
    expect(eventDelete).toContain("delivery.status = 'pending'");
    expect(eventDelete).toContain("delivery.status = 'failed'");
    expect(eventDelete).toContain("delivery.attempts <");

    const deliveryDelete = sqlText(mocks.execute.mock.calls[2][0]);
    expect(deliveryDelete).toContain("delivery.status = 'sent'");
    expect(deliveryDelete).toContain("delivery.attempts >=");
    expect(deliveryDelete).toContain("alert_delivery_events");

    const groupDelete = sqlText(mocks.execute.mock.calls[3][0]);
    expect(groupDelete).toContain("alert_notification_group_events");
  });

  it("only sweeps inactive instances past the cutoff", async () => {
    mocks.execute.mockResolvedValue({ rowCount: 0 });

    await cleanupAlertingHistory({
      now: new Date("2026-08-06T12:00:00Z"),
      batchSize: 100,
      maxBatches: 1,
    });

    const instanceDelete = sqlText(mocks.execute.mock.calls[5][0]);
    expect(instanceDelete).toContain("status = 'inactive'");
    expect(instanceDelete).toContain("updated_at <");
    expect(instanceDelete).toContain("alert_instances");
  });
});
