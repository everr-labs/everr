import { beforeEach, describe, expect, it, vi } from "vitest";

const txExecute = vi.fn();
const transaction = vi.fn();

vi.mock("@/db/client", () => ({
  db: {
    transaction: (
      fn: (tx: { execute: typeof txExecute }) => Promise<unknown>,
    ) => transaction(fn),
  },
}));

import { scanDueAlerts } from "./scanner";

function drizzleSqlText(value: unknown): string {
  const chunks =
    (value as { queryChunks?: { value?: string[] }[] } | undefined)
      ?.queryChunks ?? [];
  return chunks.flatMap((chunk) => chunk.value ?? []).join("");
}

beforeEach(() => {
  vi.clearAllMocks();
  transaction.mockImplementation((fn) => fn({ execute: txExecute }));
});

describe("scanDueAlerts", () => {
  it("claims due alerts and enqueues evaluate jobs in the same transaction", async () => {
    const due = new Date("2026-06-10T12:00:00.000Z");
    txExecute
      .mockResolvedValueOnce({
        rows: [
          {
            id: "a1",
            organization_id: "org-1",
            evaluation_scheduled_at: due,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(scanDueAlerts({ batchSize: 100 })).resolves.toBe(1);

    expect(transaction).toHaveBeenCalledOnce();
    expect(txExecute).toHaveBeenCalledTimes(2);
    const claimSql = drizzleSqlText(txExecute.mock.calls[0]?.[0]);
    expect(claimSql).toContain("SELECT now() AS claimed_at");
    expect(claimSql).toContain(
      "next_evaluation_at = claim.claimed_at + make_interval",
    );
    expect(claimSql).toContain("claim.claimed_at AS evaluation_scheduled_at");
    expect(claimSql).not.toContain(
      "next_evaluation_at = due.next_evaluation_at + make_interval",
    );
    expect(txExecute.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ queryChunks: expect.any(Array) }),
    );
  });

  it("returns 0 and does not enqueue when nothing is due", async () => {
    txExecute.mockResolvedValueOnce({ rows: [] });

    await expect(scanDueAlerts({ batchSize: 100 })).resolves.toBe(0);

    expect(txExecute).toHaveBeenCalledTimes(1);
  });
});
