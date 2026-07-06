import { describe, expect, it, vi } from "vitest";
import { queryAlertHistory } from "./history.server";

describe("queryAlertHistory", () => {
  it("filters app.logs by scope, slug, event type, and time range", async () => {
    const ch = vi.fn().mockResolvedValue([]);
    await queryAlertHistory(ch, "high-5xx", {
      limit: 50,
      fromISO: "2026-06-01T00:00:00Z",
      toISO: "2026-06-16T00:00:00Z",
    });
    const [sql, params] = ch.mock.calls[0];
    expect(sql).toContain("FROM app.logs");
    expect(sql).toContain("ScopeName = 'everr.alerting'");
    expect(sql).toContain("LogAttributes['alert.slug'] = {slug:String}");
    expect(sql).toContain("IN ('instance_fired', 'instance_resolved')");
    expect(sql).toContain("LogAttributes['alert.evidence_json']");
    expect(sql).toContain("LogAttributes['alert.evidence_truncated']");
    expect(params).toMatchObject({
      slug: "high-5xx",
      limit: 50,
      fromTime: "2026-06-01T00:00:00Z",
      toTime: "2026-06-16T00:00:00Z",
    });
  });

  const baseRawRow = {
    timestamp: "2026-06-10T00:00:00Z",
    eventType: "instance_fired",
    deliveryTargetsJson: "{}",
    silenced: "false",
    instanceLabelsJson: "{}",
    instanceFingerprint: "fp1",
    rowCount: "1",
    evidenceJson: "",
    evidenceTruncated: "false",
  };

  async function runWithRawRow(overrides: Record<string, string>) {
    const ch = vi.fn().mockResolvedValue([{ ...baseRawRow, ...overrides }]);
    const [row] = await queryAlertHistory(ch, "high-5xx", {
      limit: 50,
      fromISO: "2026-06-01T00:00:00Z",
      toISO: "2026-06-16T00:00:00Z",
    });
    return row;
  }

  it("parses a valid evidence object into a record", async () => {
    const row = await runWithRawRow({
      evidenceJson: '{"status_code":"500","count":42}',
    });
    expect(row.evidence).toEqual({ status_code: "500", count: 42 });
    expect(row.evidenceTruncated).toBe(false);
  });

  it("collapses malformed evidence JSON to null", async () => {
    const row = await runWithRawRow({ evidenceJson: "{not json" });
    expect(row.evidence).toBeNull();
  });

  it("collapses non-object evidence (arrays/scalars) to null", async () => {
    expect(
      (await runWithRawRow({ evidenceJson: "[1,2,3]" })).evidence,
    ).toBeNull();
    expect(
      (await runWithRawRow({ evidenceJson: '"scalar"' })).evidence,
    ).toBeNull();
  });

  it("treats an absent evidence attribute as null", async () => {
    const row = await runWithRawRow({ evidenceJson: "" });
    expect(row.evidence).toBeNull();
  });

  it("maps the evidence_truncated flag to a boolean", async () => {
    expect(
      (await runWithRawRow({ evidenceTruncated: "true" })).evidenceTruncated,
    ).toBe(true);
    expect(
      (await runWithRawRow({ evidenceTruncated: "false" })).evidenceTruncated,
    ).toBe(false);
    // Any value other than the literal "true" is false.
    expect(
      (await runWithRawRow({ evidenceTruncated: "" })).evidenceTruncated,
    ).toBe(false);
  });

  it("does not leak the raw evidenceJson field onto the mapped row", async () => {
    const row = await runWithRawRow({
      evidenceJson: '{"count":1}',
    });
    expect(row).not.toHaveProperty("evidenceJson");
  });
});
