import { beforeEach, describe, expect, it, vi } from "vitest";

const dbExecute = vi.fn();

vi.mock("@/db/client", () => ({
  db: {
    execute: (...args: unknown[]) => dbExecute(...args),
  },
}));

const addWorkerJob = vi.fn();
vi.mock("@/server/worker/jobs", () => ({
  addWorkerJob: (...args: unknown[]) => addWorkerJob(...args),
}));

import { scanDueAlerts } from "./01-scanner";

function drizzleSqlText(value: unknown): string {
  const chunks =
    (value as { queryChunks?: { value?: string[] }[] } | undefined)
      ?.queryChunks ?? [];
  return chunks.flatMap((chunk) => chunk.value ?? []).join("");
}

beforeEach(() => {
  vi.clearAllMocks();
  addWorkerJob.mockResolvedValue(undefined);
});

describe("scanDueAlerts", () => {
  it("claims due alerts and enqueues evaluate jobs via the public API", async () => {
    const due = new Date("2026-06-10T12:00:00.000Z");
    dbExecute.mockResolvedValueOnce({
      rows: [
        {
          id: "a1",
          organization_id: "org-1",
          evaluation_scheduled_at: due,
        },
      ],
    });

    await expect(scanDueAlerts({ batchSize: 100 })).resolves.toBe(1);

    expect(dbExecute).toHaveBeenCalledOnce();
    const claimSql = drizzleSqlText(dbExecute.mock.calls[0]?.[0]);
    expect(claimSql).toContain("SELECT now() AS claimed_at");
    expect(claimSql).toContain(
      "next_evaluation_at = claim.claimed_at + make_interval",
    );
    expect(claimSql).toContain("claim.claimed_at AS evaluation_scheduled_at");
    expect(claimSql).not.toContain(
      "next_evaluation_at = due.next_evaluation_at + make_interval",
    );

    expect(addWorkerJob).toHaveBeenCalledOnce();
    expect(addWorkerJob).toHaveBeenCalledWith(
      "alerts/evaluate",
      {
        alertDefinitionId: "a1",
        scheduledFor: "2026-06-10T12:00:00.000Z",
      },
      {
        jobKey: "alerts/evaluate:a1:2026-06-10T12:00:00.000Z",
        jobKeyMode: "replace",
        maxAttempts: 3,
        queueName: "alerts:eval:org-1",
      },
    );
  });

  it("returns 0 and does not enqueue when nothing is due", async () => {
    dbExecute.mockResolvedValueOnce({ rows: [] });

    await expect(scanDueAlerts({ batchSize: 100 })).resolves.toBe(0);

    expect(dbExecute).toHaveBeenCalledTimes(1);
    expect(addWorkerJob).not.toHaveBeenCalled();
  });
});
