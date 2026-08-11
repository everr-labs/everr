import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
  history: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mocks.rows),
      }),
    }),
  },
  pool: {},
}));

vi.mock("./clickhouse", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  recordAlertHistoryStrict: mocks.history,
}));

import { projectAlertLifecycle } from "./project-lifecycle";

const CLOSED_ID = "019c3aba-29f8-7d6e-9e55-301cf47fa80d";
const CANCELED_ID = "019c3aba-4444-7d6e-9e55-301cf47fa80d";
const EPISODE_ID = "019c3ab6-54d6-7e26-bc76-8cadd67542fb";

const journalRow = (overrides: Record<string, unknown>) => ({
  organizationId: "org-1",
  repoid: "host/owner/repo",
  previewId: null,
  sourceDefinitionId: "6f1c9d20-3b7a-4c11-9f2e-8a5d4c3b2a10",
  slug: "default/high-5xx",
  instanceFingerprint: "api",
  instanceLabels: { service: "api" },
  severity: "critical",
  suppressed: false,
  occurredAt: new Date("2026-08-09T10:00:00Z"),
  processedAt: new Date("2026-08-09T10:00:00Z"),
  episodeId: EPISODE_ID,
  reason: "",
  ...overrides,
});

describe("projectAlertLifecycle", () => {
  beforeEach(() => {
    mocks.rows = [];
    mocks.history.mockReset().mockResolvedValue(undefined);
  });

  it("projects closed terminals and canceled-notification suppressions from the journal", async () => {
    mocks.rows = [
      journalRow({
        id: CLOSED_ID,
        eventType: "instance_closed",
        kind: "state",
        reason: "rule_paused",
      }),
      journalRow({
        id: CANCELED_ID,
        eventType: "instance_fired",
        kind: "notifying",
      }),
    ];

    await projectAlertLifecycle({
      closedEventIds: [CLOSED_ID],
      suppressedEventIds: [CANCELED_ID],
      reason: "rule_paused",
    });

    const rows = mocks.history.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      event_id: CLOSED_ID,
      event_type: "instance_closed",
      episode_id: EPISODE_ID,
      reason: "rule_paused",
      notification_event_id: "00000000-0000-0000-0000-000000000000",
    });
    expect(rows[1]).toMatchObject({
      event_type: "notification_suppressed",
      notification_event_id: CANCELED_ID,
      reason: "rule_paused",
      silenced: false,
      inhibited: false,
    });
  });

  // The task's only job is the insert; a swallowed failure would report
  // success to Graphile while the chain's terminals are lost. Failing loudly
  // is what makes the task's retries real.
  it("propagates an insert failure so Graphile retries", async () => {
    mocks.rows = [journalRow({ id: CLOSED_ID, eventType: "instance_closed" })];
    mocks.history.mockRejectedValueOnce(new Error("clickhouse unavailable"));

    await expect(
      projectAlertLifecycle({
        closedEventIds: [CLOSED_ID],
        suppressedEventIds: [],
        reason: "rule_paused",
      }),
    ).rejects.toThrow("clickhouse unavailable");
  });

  // The suppression row's event_time comes from the chain it terminates, not
  // from any clock this task reads, so a retry writes the same bytes even when
  // the journal row carries no processedAt at all.
  it("gives a retry the same event_time whatever the journal row's stamps say", async () => {
    const row = journalRow({
      id: CANCELED_ID,
      eventType: "instance_fired",
      kind: "notifying",
      processedAt: null,
    });
    const project = async () => {
      mocks.rows = [row];
      mocks.history.mockClear();
      await projectAlertLifecycle({
        closedEventIds: [],
        suppressedEventIds: [CANCELED_ID],
        reason: "rule_paused",
      });
      return mocks.history.mock.calls[0][0][0];
    };

    expect(await project()).toEqual(await project());
  });

  it("writes nothing for ids the journal no longer has", async () => {
    mocks.rows = [];

    await projectAlertLifecycle({
      closedEventIds: [CLOSED_ID],
      suppressedEventIds: [],
      reason: "rule_deleted",
    });

    expect(mocks.history).not.toHaveBeenCalled();
  });
});
