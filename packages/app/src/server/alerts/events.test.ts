import { describe, expect, it } from "vitest";
import {
  boundEvidence,
  buildDeliveryEvent,
  buildEvaluationEvent,
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

  it("builds delivery events with target, outcome, and silence id", () => {
    expect(
      buildDeliveryEvent({
        def,
        target: "telegram",
        outcome: "silenced",
        silenceId: "sil-1",
      }),
    ).toMatchObject({
      event_type: "delivery_attempt",
      delivery_target_type: "telegram",
      delivery_outcome: "silenced",
      silence_id: "sil-1",
    });
  });
});
