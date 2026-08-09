import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insertAdminRows: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/clickhouse", () => ({
  insertAdminRows: mocks.insertAdminRows,
}));

vi.mock("@/telemetry/logger", () => ({
  exceptionAttributes: vi.fn(() => ({})),
  serverLogger: { error: mocks.error },
}));

import {
  deliveryHistoryRow,
  evaluationHistoryRow,
  instanceHistoryRow,
  recordAlertHistory,
  suppressionHistoryRow,
  ZERO_UUID,
} from "./clickhouse";

const def = {
  id: "019c3ab6-54d6-7e26-bc76-8cadd67542fb",
  organizationId: "org-1",
  repoid: "repo-1",
  slug: "default/high-5xx",
  previewId: null,
  severity: "critical",
  suppressed: false,
};
const scheduledFor = new Date("2026-08-07T12:00:00Z");
const occurredAt = new Date("2026-08-07T12:00:01Z");

describe("ClickHouse alert history", () => {
  beforeEach(() => {
    mocks.insertAdminRows.mockReset().mockResolvedValue(undefined);
    mocks.error.mockReset();
  });

  it("records evaluation samples and transition evidence with async inserts", async () => {
    const evaluation = evaluationHistoryRow({
      def,
      scheduledFor,
      occurredAt,
      rowCount: 1,
      evidenceJson: '[{"service":"api","value":42}]',
      evidenceTruncated: false,
      samples: [
        {
          fingerprint: "api",
          labels: { service: "api" },
          value: 42,
        },
      ],
      samplesTruncated: false,
    });
    const transition = instanceHistoryRow({
      def,
      eventId: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
      eventType: "instance_fired",
      scheduledFor,
      occurredAt,
      fingerprint: "api",
      labels: { service: "api" },
      evidence: { value: 42 },
      evidenceTruncated: false,
    });

    await recordAlertHistory(def.id, [evaluation, transition]);

    expect(mocks.insertAdminRows).toHaveBeenCalledWith(
      "app.alert_events",
      [evaluation, transition],
      {
        async_insert: 1,
        wait_for_async_insert: 1,
        date_time_input_format: "best_effort",
      },
    );
    expect(evaluation).toMatchObject({
      event_type: "evaluation_succeeded",
      row_count: 1,
      evidence_json: '[{"service":"api","value":42}]',
      samples_json:
        '[{"fingerprint":"api","labels":{"service":"api"},"value":42}]',
    });
    expect(transition).toMatchObject({
      event_id: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
      event_type: "instance_fired",
      evidence_json: '{"value":42}',
    });
  });

  it("heads its own notification chain from a transition", () => {
    const transition = instanceHistoryRow({
      def,
      eventId: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
      eventType: "instance_fired",
      scheduledFor,
      occurredAt,
      fingerprint: "api",
      labels: { service: "api" },
      evidence: {},
      evidenceTruncated: false,
    });

    expect(transition.notification_event_id).toBe(transition.event_id);
    // Evaluation rows belong to no notification.
    expect(
      evaluationHistoryRow({
        def,
        scheduledFor,
        occurredAt,
        rowCount: 0,
        evidenceJson: "[]",
        evidenceTruncated: false,
        samples: [],
        samplesTruncated: false,
      }).notification_event_id,
    ).toBe(ZERO_UUID);
  });

  it("freezes the suppression decision against the transition it withheld", () => {
    const row = suppressionHistoryRow({
      def,
      notificationEventId: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
      occurredAt,
      scheduledFor,
      fingerprint: "api",
      labels: { service: "api" },
      silenced: true,
      inhibited: false,
      silenceId: "019c3abf-0000-7000-8000-000000000001",
    });

    expect(row).toMatchObject({
      event_type: "notification_suppressed",
      notification_event_id: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
      silenced: true,
      inhibited: false,
      silence_id: "019c3abf-0000-7000-8000-000000000001",
    });
    // Its own id, so the row is addressable independently of the transition.
    expect(row.event_id).not.toBe(row.notification_event_id);
  });

  it("records delivery outcomes with channel targets and no error on success", () => {
    const sent = deliveryHistoryRow({
      def,
      notificationEventId: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
      occurredAt,
      scheduledFor,
      fingerprint: "api",
      labels: { service: "api" },
      deliveryTargets: { slack: ["on-call"] },
    });
    const failed = deliveryHistoryRow({
      def,
      notificationEventId: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
      occurredAt,
      scheduledFor,
      fingerprint: "api",
      labels: { service: "api" },
      deliveryTargets: { slack: ["on-call"] },
      error: "429 Too Many Requests",
    });

    expect(sent).toMatchObject({
      event_type: "delivery_succeeded",
      delivery_targets: { slack: ["on-call"] },
      error: "",
      evidence_json: "{}",
    });
    expect(failed).toMatchObject({
      event_type: "delivery_failed",
      error: "429 Too Many Requests",
      evidence_json: '{"error":"429 Too Many Requests"}',
    });
  });

  it("treats an empty error string as a success rather than a failure", () => {
    expect(
      deliveryHistoryRow({
        def,
        notificationEventId: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
        occurredAt,
        scheduledFor,
        fingerprint: "api",
        labels: { service: "api" },
        deliveryTargets: { slack: ["on-call"] },
        error: "",
      }).event_type,
    ).toBe("delivery_succeeded");
  });

  it("does not fail alert evaluation when history storage is unavailable", async () => {
    mocks.insertAdminRows.mockRejectedValue(new Error("unavailable"));

    await expect(
      recordAlertHistory(def.id, [
        evaluationHistoryRow({
          def,
          scheduledFor,
          occurredAt,
          rowCount: 0,
          evidenceJson: "[]",
          evidenceTruncated: false,
          samples: [],
          samplesTruncated: false,
        }),
      ]),
    ).resolves.toBeUndefined();
    expect(mocks.error).toHaveBeenCalledWith(
      "alerts.history.insert_failed",
      expect.objectContaining({
        "alert.definition_id": def.id,
        "error.handled": true,
      }),
    );
  });
});
