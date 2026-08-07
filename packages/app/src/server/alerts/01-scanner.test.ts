import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
  addWorkerJob: vi.fn(),
  update: vi.fn(() => ({
    set: () => ({ where: () => Promise.resolve() }),
  })),
}));

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(mocks.rows),
          }),
        }),
      }),
    }),
    update: mocks.update,
  },
}));

vi.mock("@/server/worker/jobs", () => ({
  addWorkerJob: mocks.addWorkerJob,
}));

import {
  ALERT_EVALUATE_TASK,
  alertEvaluationJobKey,
  alertingPartitionQueue,
  alertingRetryAt,
  alertingRetryDelaySeconds,
  nextAlertEvaluationAt,
  SLO_EVALUATE_TASK,
  scanDueAlerts,
  scanDueSlos,
} from "./01-scanner";

describe("alert scanner", () => {
  beforeEach(() => {
    mocks.rows = [];
    mocks.addWorkerJob.mockReset().mockResolvedValue(undefined);
    mocks.update.mockClear();
  });

  it("enqueues due rules with stable schedule keys and bounded queues", async () => {
    const scheduledFor = new Date("2026-08-06T10:00:00Z");
    mocks.rows = [{ id: "rule-1", scheduledFor, version: 4 }];

    await expect(scanDueAlerts()).resolves.toBe(1);
    expect(mocks.addWorkerJob).toHaveBeenCalledWith(
      ALERT_EVALUATE_TASK,
      {
        alertDefinitionId: "rule-1",
        scheduledFor: scheduledFor.toISOString(),
        ruleVersion: 4,
      },
      expect.objectContaining({
        jobKey: alertEvaluationJobKey("rule-1", scheduledFor.toISOString()),
        queueName: alertingPartitionQueue("alert", "rule-1"),
      }),
    );
  });

  it("enqueues due SLOs", async () => {
    const scheduledFor = new Date("2026-08-06T10:00:00Z");
    mocks.rows = [{ id: "slo-1", scheduledFor, version: 2 }];

    await expect(scanDueSlos()).resolves.toBe(1);
    expect(mocks.addWorkerJob).toHaveBeenCalledWith(
      SLO_EVALUATE_TASK,
      expect.objectContaining({ sloDefinitionId: "slo-1", sloVersion: 2 }),
      expect.objectContaining({
        queueName: alertingPartitionQueue("slo", "slo-1"),
      }),
    );
  });

  it("uses only 64 queue partitions", () => {
    const queues = new Set(
      Array.from({ length: 2_000 }, (_, index) =>
        alertingPartitionQueue("alert", `rule-${index}`),
      ),
    );
    expect(queues.size).toBeLessThanOrEqual(64);
  });

  it("assigns a stable phase within each evaluation interval", () => {
    const after = new Date("2026-08-06T10:00:00.000Z");
    const first = nextAlertEvaluationAt("org-1", "rule-1", 60, after);
    const repeated = nextAlertEvaluationAt("org-1", "rule-1", 60, after);
    const next = nextAlertEvaluationAt(
      "org-1",
      "rule-1",
      60,
      new Date(after.getTime() + 60_000),
    );

    expect(first).toEqual(repeated);
    expect(first.getTime()).toBeGreaterThan(after.getTime());
    expect(first.getTime()).toBeLessThanOrEqual(after.getTime() + 60_000);
    expect(next.getTime() - first.getTime()).toBe(60_000);
  });

  it("spreads definition phases across the interval", () => {
    const after = new Date("2026-08-06T10:00:00.000Z");
    const phases = new Set(
      Array.from({ length: 256 }, (_, index) =>
        nextAlertEvaluationAt(
          `org-${index % 8}`,
          `rule-${index}`,
          60,
          after,
        ).getTime(),
      ),
    );

    expect(phases.size).toBeGreaterThan(240);
  });

  it("keeps retry delays separate from recurring phases", () => {
    const after = new Date("2026-08-06T10:00:00.000Z");

    expect(alertingRetryAt(120, after).getTime() - after.getTime()).toBe(
      120_000,
    );
  });

  it("retries quickly before backing off to the configured maximum", () => {
    expect(alertingRetryDelaySeconds(60, 1, 960)).toBe(10);
    expect(alertingRetryDelaySeconds(60, 2, 960)).toBe(20);
    expect(alertingRetryDelaySeconds(60, 8, 60)).toBe(60);
  });
});
