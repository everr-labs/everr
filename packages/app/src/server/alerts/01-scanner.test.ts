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

const mockEnv = vi.hoisted(() => ({
  EVERR_PREVIEW_ALERTS: "on" as "on" | "off",
}));
vi.mock("@/env", () => ({ env: mockEnv }));

import { scanDueAlerts } from "./01-scanner";

function drizzleSqlText(value: unknown): string {
  const chunks =
    (value as { queryChunks?: unknown[] } | undefined)?.queryChunks ?? [];
  return chunks
    .flatMap((chunk) => {
      const c = chunk as { value?: string[]; queryChunks?: unknown[] };
      if (c.value) return c.value;
      // Nested `sql` fragments (e.g. conditional AND clauses) are their own
      // SQL objects, not flattened into `value` — recurse into those too.
      if (c.queryChunks) return [drizzleSqlText(c)];
      return [];
    })
    .join("");
}

beforeEach(() => {
  vi.clearAllMocks();
  addWorkerJob.mockResolvedValue(undefined);
  mockEnv.EVERR_PREVIEW_ALERTS = "on";
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
    // Claims alerts due within the grace window so per-minute cron jitter can't
    // push a 1-minute alert past its tick and skip an evaluation.
    expect(claimSql).toContain(
      "next_evaluation_at <= now() + make_interval(secs =>",
    );
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

  it("does not filter out preview rows when the kill-switch is on (default)", async () => {
    dbExecute.mockResolvedValueOnce({ rows: [] });

    await scanDueAlerts({ batchSize: 100 });

    const claimSql = drizzleSqlText(dbExecute.mock.calls[0]?.[0]);
    expect(claimSql).not.toContain("AND preview_id IS NULL");
  });

  it("excludes preview rows from the due set when the kill-switch is off", async () => {
    mockEnv.EVERR_PREVIEW_ALERTS = "off";
    dbExecute.mockResolvedValueOnce({ rows: [] });

    await scanDueAlerts({ batchSize: 100 });

    const claimSql = drizzleSqlText(dbExecute.mock.calls[0]?.[0]);
    expect(claimSql).toContain("AND preview_id IS NULL");
  });
});
