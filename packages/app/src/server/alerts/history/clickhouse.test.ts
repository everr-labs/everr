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
  recordAlertHistoryStrict,
  suppressionHistoryRow,
  ZERO_UUID,
} from "./clickhouse";
import { uuidv7Time } from "./ids";

const def = {
  id: "019c3ab6-54d6-7e26-bc76-8cadd67542fb",
  organizationId: "org-1",
  repoid: "repo-1",
  slug: "default/high-5xx",
  previewId: null,
  severity: "critical",
  ruleMuted: false,
};
const scheduledFor = new Date("2026-08-07T12:00:00Z");
const occurredAt = new Date("2026-08-07T12:00:01Z");
const EPOCH_ISO = "1970-01-01T00:00:00.000Z";

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
      occurredAt,
      episodeId: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
      fingerprint: "api",
      labels: { service: "api" },
      evidence: { value: 42 },
      evidenceTruncated: false,
      contextJson: '{"summary":"42 errors"}',
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
      write_source: "live",
      row_count: 1,
      evidence_json: '[{"service":"api","value":42}]',
      samples_json:
        '[{"fingerprint":"api","labels":{"service":"api"},"value":42}]',
      evaluation_scheduled_at: scheduledFor.toISOString(),
    });
    expect(transition).toMatchObject({
      event_id: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
      event_type: "instance_fired",
      // A transition runs no query; row_count must not claim otherwise.
      row_count: 0,
      evidence_json: '{"value":42}',
      context_json: '{"summary":"42 errors"}',
      instance_labels: { service: "api" },
      service_name: "api",
    });
  });

  it("mints time-decodable v7 ids for rows without a caller-supplied id", () => {
    const evaluation = evaluationHistoryRow({
      def,
      scheduledFor,
      occurredAt,
      rowCount: 0,
      evidenceJson: "[]",
      evidenceTruncated: false,
      samples: [],
      samplesTruncated: false,
    });
    expect(uuidv7Time(evaluation.event_id).toISOString()).toBe(
      occurredAt.toISOString(),
    );
  });

  it("stamps the epoch sentinel on evaluation_scheduled_at off evaluation rows", () => {
    const transition = instanceHistoryRow({
      def,
      eventId: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
      eventType: "instance_fired",
      occurredAt,
      episodeId: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
      fingerprint: "api",
      labels: {},
      evidence: {},
      evidenceTruncated: false,
      contextJson: "{}",
    });
    expect(transition.evaluation_scheduled_at).toBe(EPOCH_ISO);
  });

  it("heads its own notification chain from a transition", () => {
    const transition = instanceHistoryRow({
      def,
      eventId: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
      eventType: "instance_fired",
      occurredAt,
      episodeId: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
      fingerprint: "api",
      labels: { service: "api" },
      evidence: {},
      evidenceTruncated: false,
      contextJson: "{}",
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

  it("keeps pending and closed rows outside any notification chain", () => {
    const pending = instanceHistoryRow({
      def,
      eventId: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
      eventType: "instance_pending",
      occurredAt,
      episodeId: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
      fingerprint: "api",
      labels: { service: "api" },
      evidence: {},
      evidenceTruncated: false,
      contextJson: "{}",
    });
    const closed = instanceHistoryRow({
      def,
      eventId: "019c3aba-4444-7d6e-9e55-301cf47fa80d",
      eventType: "instance_closed",
      occurredAt,
      episodeId: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
      fingerprint: "api",
      labels: { service: "api" },
      evidence: {},
      evidenceTruncated: false,
      contextJson: "{}",
      reason: "rule_paused",
    });

    expect(pending.notification_event_id).toBe(ZERO_UUID);
    expect(pending.episode_id).toBe("019c3aba-29f8-7d6e-9e55-301cf47fa80d");
    expect(closed.notification_event_id).toBe(ZERO_UUID);
    expect(closed.episode_id).toBe("019c3aba-29f8-7d6e-9e55-301cf47fa80d");
    expect(closed.reason).toBe("rule_paused");
  });

  // A projection retry or a racing second writer must land on the same row
  // id: one terminal suppression per chain, never a phantom second one.
  it("converges suppression rows for one chain on one id", () => {
    const opts = {
      def,
      notificationEventId: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
      occurredAt,
      fingerprint: "api",
      labels: { service: "api" },
      silenced: false,
      inhibited: false,
      silenceId: null,
    };
    expect(suppressionHistoryRow(opts).event_id).toBe(
      suppressionHistoryRow(opts).event_id,
    );
    expect(suppressionHistoryRow(opts).event_id).not.toBe(
      suppressionHistoryRow({
        ...opts,
        notificationEventId: "019c3abf-0000-7000-8000-000000000002",
      }).event_id,
    );
  });

  it("carries a lifecycle reason on a terminal suppression", () => {
    const row = suppressionHistoryRow({
      def,
      notificationEventId: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
      occurredAt,
      fingerprint: "api",
      labels: { service: "api" },
      silenced: false,
      inhibited: false,
      silenceId: null,
      reason: "rule_paused",
    });
    expect(row.reason).toBe("rule_paused");
    expect(row.silenced).toBe(false);
  });

  it("freezes the suppression decision against the transition it withheld", () => {
    const row = suppressionHistoryRow({
      def,
      notificationEventId: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
      occurredAt,
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

  it("writes the zero UUID, not an empty string, when no silence matched", () => {
    expect(
      suppressionHistoryRow({
        def,
        notificationEventId: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
        occurredAt,
        fingerprint: "api",
        labels: {},
        silenced: false,
        inhibited: true,
        silenceId: null,
      }).silence_id,
    ).toBe(ZERO_UUID);
  });

  it("records delivery outcomes with deterministic ids, targets, and a sanitized error", () => {
    const opts = {
      def,
      notificationEventId: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
      dedupKey: "group-1:slack:on-call",
      occurredAt,
      fingerprint: "api",
      labels: { service: "api" },
      deliveryTargets: { slack: ["on-call"] },
      outcome: "succeeded" as const,
    };
    const sent = deliveryHistoryRow(opts);
    const sentAgain = deliveryHistoryRow(opts);
    const failed = deliveryHistoryRow({
      ...opts,
      outcome: "failed",
      error:
        "429 Too Many Requests from https://hooks.slack.com/services/T0/B0/secret",
    });

    expect(sent).toMatchObject({
      event_type: "delivery_succeeded",
      delivery_targets: { slack: ["on-call"] },
      delivery_dedup_key: "group-1:slack:on-call",
      error: "",
      evidence_json: "{}",
    });
    // A retry that re-records the same outcome converges on the same row id.
    expect(sentAgain.event_id).toBe(sent.event_id);
    expect(failed.event_type).toBe("delivery_failed");
    expect(failed.event_id).not.toBe(sent.event_id);
    expect(failed.error).not.toContain("hooks.slack.com");
    expect(failed.error).not.toContain("secret");
    expect(failed.evidence_json).not.toContain("secret");
  });

  // Classified as a success it would take the convergent success id, and the
  // append-only trail would permanently claim a delivery that never happened.
  it("keeps a failure with an empty message a failure", () => {
    const opts = {
      def,
      notificationEventId: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
      dedupKey: "group-1:slack:on-call",
      occurredAt,
      fingerprint: "api",
      labels: { service: "api" },
      deliveryTargets: { slack: ["on-call"] },
    };
    const emptyFailure = deliveryHistoryRow({
      ...opts,
      outcome: "failed",
      error: "",
    });

    expect(emptyFailure.event_type).toBe("delivery_failed");
    expect(emptyFailure.event_id).not.toBe(
      deliveryHistoryRow({ ...opts, outcome: "succeeded" }).event_id,
    );
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

  describe("recordAlertHistoryStrict", () => {
    // A Graphile retry resends the exact same rows (built from the same
    // journal rows read by id), so a stable token is what makes the retry
    // converge instead of duplicating terminal rows.
    it("inserts synchronously with a token derived from the sorted row ids", async () => {
      const first = suppressionHistoryRow({
        def,
        notificationEventId: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
        occurredAt,
        fingerprint: "api",
        labels: { service: "api" },
        silenced: false,
        inhibited: false,
        silenceId: null,
        reason: "rule_paused",
      });
      const second = instanceHistoryRow({
        def,
        eventId: "019c3aba-1111-7d6e-9e55-301cf47fa80d",
        eventType: "instance_closed",
        occurredAt,
        episodeId: ZERO_UUID,
        fingerprint: "api",
        labels: { service: "api" },
        evidence: {},
        evidenceTruncated: false,
        contextJson: "{}",
        reason: "rule_paused",
      });

      // Passed in reverse-sorted order: the token must not depend on it.
      await recordAlertHistoryStrict([first, second]);

      expect(mocks.insertAdminRows).toHaveBeenCalledWith(
        "app.alert_events",
        [first, second],
        {
          async_insert: 0,
          date_time_input_format: "best_effort",
          insert_deduplication_token: `app.alert_events:${[
            first.event_id,
            second.event_id,
          ]
            .sort()
            .join(",")}`,
        },
      );
    });

    it("does not insert for an empty batch", async () => {
      await recordAlertHistoryStrict([]);
      expect(mocks.insertAdminRows).not.toHaveBeenCalled();
    });

    it("throws rather than swallowing a failed insert", async () => {
      mocks.insertAdminRows.mockRejectedValue(new Error("unavailable"));
      const row = instanceHistoryRow({
        def,
        eventId: "019c3aba-29f8-7d6e-9e55-301cf47fa80d",
        eventType: "instance_closed",
        occurredAt,
        episodeId: ZERO_UUID,
        fingerprint: "api",
        labels: { service: "api" },
        evidence: {},
        evidenceTruncated: false,
        contextJson: "{}",
        reason: "rule_paused",
      });

      await expect(recordAlertHistoryStrict([row])).rejects.toThrow(
        "unavailable",
      );
    });
  });
});
