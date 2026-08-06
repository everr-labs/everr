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

import { processAlertEvent } from "./dispatcher";

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
