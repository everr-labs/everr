import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  linkedRows: [] as Record<string, unknown>[],
  selectError: null as Error | null,
  recordAlertHistory: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/db/schema", () => ({
  alertDeliveryEvents: {
    organizationId: "de_org",
    deliveryDedupKey: "de_dedup",
    eventId: "de_event",
  },
  alertEvents: {
    organizationId: "ae_org",
    id: "ae_id",
    sourceDefinitionId: "ae_def",
  },
  alertDefinitions: { organizationId: "ad_org", id: "ad_id", spec: "ad_spec" },
}));

vi.mock("@/db/client", () => ({
  db: {
    select: vi.fn(() => {
      const chain = {
        from: vi.fn(() => chain),
        innerJoin: vi.fn(() => chain),
        leftJoin: vi.fn(() => chain),
        where: vi.fn(() =>
          mocks.selectError
            ? Promise.reject(mocks.selectError)
            : Promise.resolve(mocks.linkedRows),
        ),
      };
      return chain;
    }),
  },
}));

vi.mock("../history/clickhouse", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  recordAlertHistory: mocks.recordAlertHistory,
}));

vi.mock("@/telemetry/logger", () => ({
  exceptionAttributes: vi.fn(() => ({})),
  serverLogger: { error: mocks.error },
}));

import { deliveryTargets, recordDeliveryOutcome } from "./history";

const linkedEvent = {
  event: {
    id: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
    sourceDefinitionId: "019c3ab6-54d6-7e26-bc76-8cadd67542fb",
    organizationId: "org-1",
    repoid: "repo-1",
    slug: "default/high-5xx",
    previewId: null,
    severity: "critical",
    suppressed: false,
    instanceFingerprint: "fp-1",
    instanceLabels: { host: "web-1" },
    occurredAt: new Date("2026-06-10T00:00:00Z"),
  },
};

const outcome = {
  organizationId: "org-1",
  dedupKey: "dedup-1",
  channelType: "slack",
  channelName: "on-call",
  occurredAt: new Date("2026-06-10T00:00:05Z"),
  outcome: "succeeded",
} as const;

beforeEach(() => {
  mocks.linkedRows = [linkedEvent];
  mocks.selectError = null;
  mocks.recordAlertHistory.mockReset().mockResolvedValue(undefined);
  mocks.error.mockReset();
});

describe("deliveryTargets", () => {
  it("names the channel rather than its address", () => {
    expect(deliveryTargets("slack", "on-call")).toEqual({
      slack: ["on-call"],
    });
  });
});

describe("recordDeliveryOutcome", () => {
  it("writes one trail row per alert event the delivery carried", async () => {
    mocks.linkedRows = [
      linkedEvent,
      {
        event: {
          ...linkedEvent.event,
          id: "019c3abf-0000-7000-8000-000000000002",
          instanceFingerprint: "fp-2",
        },
      },
    ];

    await recordDeliveryOutcome(outcome);

    const [definitionId, rows] = mocks.recordAlertHistory.mock.calls[0];
    expect(definitionId).toBe("019c3ab6-54d6-7e26-bc76-8cadd67542fb");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      event_type: "delivery_succeeded",
      notification_event_id: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
      delivery_targets: { slack: ["on-call"] },
    });
    expect(rows[1]).toMatchObject({
      notification_event_id: "019c3abf-0000-7000-8000-000000000002",
      instance_fingerprint: "fp-2",
    });
  });

  it("marks the trail as failed when the send reported an error", async () => {
    await recordDeliveryOutcome({
      ...outcome,
      outcome: "failed",
      error: "429",
    });

    expect(mocks.recordAlertHistory.mock.calls[0][1][0]).toMatchObject({
      event_type: "delivery_failed",
      error: "429",
    });
  });

  it("writes nothing when the delivery has no linked events", async () => {
    mocks.linkedRows = [];

    await recordDeliveryOutcome(outcome);

    expect(mocks.recordAlertHistory).not.toHaveBeenCalled();
  });

  // A throw here would replace the real send failure with a bookkeeping one on
  // the failure path, and on the success path would push an already-delivered
  // notification into the failure branch, so Graphile would send it again.
  it("never throws when the event lookup fails", async () => {
    mocks.selectError = new Error("connection terminated");

    await expect(recordDeliveryOutcome(outcome)).resolves.toBeUndefined();
    expect(mocks.error).toHaveBeenCalledWith(
      "alerts.history.delivery_outcome_failed",
      expect.objectContaining({
        "alert.delivery.dedup_key": "dedup-1",
        "error.handled": true,
      }),
    );
  });
});
