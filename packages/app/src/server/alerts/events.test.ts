import { describe, expect, it } from "vitest";
import {
  boundEvidence,
  buildDeliveryFailureEvent,
  buildEvaluationEvent,
  buildInstanceEvent,
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_ROWS,
} from "./events";

const def = { id: "d1", organizationId: "org-1", repoid: "r1", slug: "s1" };

describe("boundEvidence", () => {
  it("caps at 50 rows and flags truncation", () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ i }));
    const out = boundEvidence(rows);

    expect(JSON.parse(out.json)).toHaveLength(MAX_EVIDENCE_ROWS);
    expect(out.rows).toHaveLength(MAX_EVIDENCE_ROWS);
    expect(out.truncated).toBe(true);
    expect(out.rowCount).toBe(60);
    expect(out.firstRow).toEqual({ i: 0 });
  });

  it("caps at 64 KiB of JSON", () => {
    const rows = Array.from({ length: 50 }, () => ({
      blob: "x".repeat(4000),
    }));

    const out = boundEvidence(rows);

    expect(Buffer.byteLength(out.json, "utf8")).toBeLessThanOrEqual(
      MAX_EVIDENCE_BYTES,
    );
    expect(out.truncated).toBe(true);
  });
});

describe("event row construction", () => {
  it("builds evaluator events with scheduled timestamp and evidence", () => {
    const row = buildEvaluationEvent({
      def,
      eventType: "firing",
      scheduledFor: new Date("2026-06-10T12:00:00.000Z"),
      evidence: boundEvidence([{ a: 1 }]),
    });

    expect(row).toMatchObject({
      organization_id: "org-1",
      event_type: "firing",
      evaluation_scheduled_at: "2026-06-10 12:00:00.000",
      row_count: 1,
      evidence_truncated: 0,
    });
  });

  it("adds delivery targets and silence id to evaluator events", () => {
    const row = buildEvaluationEvent({
      def,
      eventType: "firing",
      scheduledFor: new Date("2026-06-10T12:00:00.000Z"),
      deliveryTargets: { email: ["alerts@example.com"], telegram: ["123"] },
      silenceId: "sil-1",
    });

    expect(row).toMatchObject({
      event_type: "firing",
      delivery_targets: {
        email: ["alerts@example.com"],
        telegram: ["123"],
      },
      silence_id: "sil-1",
    });
  });

  it("builds instance_fired with labels and source row", () => {
    const event = buildInstanceEvent({
      def,
      eventType: "instance_fired",
      scheduledFor: new Date("2026-06-11T10:00:00.000Z"),
      fingerprint: "abc123",
      labels: { route: "/x" },
      row: { route: "/x", error_count: 9 },
    });

    expect(event.event_type).toBe("instance_fired");
    expect(event.instance_fingerprint).toBe("abc123");
    expect(JSON.parse(event.instance_labels_json ?? "")).toEqual({
      route: "/x",
    });
    expect(JSON.parse(event.evidence_json ?? "")).toEqual({
      route: "/x",
      error_count: 9,
    });
    expect(event.row_count).toBe(1);
    expect(event.evaluation_scheduled_at).toBe("2026-06-11 10:00:00.000");
  });

  it("builds instance_resolved without a row", () => {
    const event = buildInstanceEvent({
      def,
      eventType: "instance_resolved",
      scheduledFor: new Date("2026-06-11T10:00:00.000Z"),
      fingerprint: "abc123",
      labels: { route: "/x" },
    });

    expect(event.event_type).toBe("instance_resolved");
    expect(event.evidence_json).toBe("{}");
    expect(event.row_count).toBe(0);
  });

  it("drops trailing entries from oversized json until it fits", () => {
    const event = buildInstanceEvent({
      def,
      eventType: "instance_fired",
      scheduledFor: new Date("2026-06-11T10:00:00.000Z"),
      fingerprint: "abc123",
      labels: { route: "/x", big: "x".repeat(70 * 1024) },
      row: { route: "/x", big: "x".repeat(70 * 1024) },
    });

    // The small leading entry survives; only the oversized one is dropped.
    expect(event.instance_labels_json).toBe('{"route":"/x"}');
    expect(event.evidence_json).toBe('{"route":"/x"}');
  });

  it("falls back to an empty object when a single entry exceeds the budget", () => {
    const event = buildInstanceEvent({
      def,
      eventType: "instance_fired",
      scheduledFor: new Date("2026-06-11T10:00:00.000Z"),
      fingerprint: "abc123",
      labels: { big: "x".repeat(70 * 1024) },
    });

    expect(event.instance_labels_json).toBe("{}");
  });

  it("builds delivery_failed events with channel, target, and error", () => {
    const event = buildDeliveryFailureEvent({
      def,
      scheduledFor: new Date("2026-06-11T10:00:00.000Z"),
      failure: {
        channel: "telegram",
        target: "-100123",
        error: "telegram sendMessage failed: 403",
      },
    });

    expect(event.event_type).toBe("delivery_failed");
    expect(event.delivery_targets).toEqual({ telegram: ["-100123"] });
    expect(event.evidence_json).toBe(
      '{"error":"telegram sendMessage failed: 403"}',
    );
    expect(event.evaluation_scheduled_at).toBe("2026-06-11 10:00:00.000");
  });
});
