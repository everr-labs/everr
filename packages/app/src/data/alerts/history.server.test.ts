import { describe, expect, it, vi } from "vitest";
import { queryAlertEventLog, queryAlertHistory } from "./history.server";

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

describe("queryAlertEventLog", () => {
  it("filters app.logs by service, scope, and time range only (rule-agnostic)", async () => {
    const ch = vi.fn().mockResolvedValue([]);
    await queryAlertEventLog(ch, {
      limit: 200,
      fromISO: "2026-06-01T00:00:00Z",
      toISO: "2026-06-16T00:00:00Z",
    });
    const [sql, params] = ch.mock.calls[0];
    expect(sql).toContain("FROM app.logs");
    expect(sql).toContain("ServiceName = 'alert'");
    expect(sql).toContain("ScopeName = 'everr.alerting'");
    // No per-rule or per-event-type narrowing: the monitor shows everything.
    expect(sql).not.toContain("alert.slug'] =");
    expect(sql).not.toContain("IN ('instance_fired'");
    // Tenancy comes from the row-level policy, never a SQL org filter.
    expect(sql).not.toMatch(/organization|tenant_id/);
    // DateTime64 params: resolveTimeRange emits fractional seconds, which a
    // String -> DateTime coercion rejects (TYPE_MISMATCH).
    expect(sql).toContain("TimestampTime >= {fromTime:DateTime64(3)}");
    expect(sql).toContain("TimestampTime <= {toTime:DateTime64(3)}");
    expect(sql).toContain("LIMIT {limit:UInt32}");
    expect(sql).toContain("LogAttributes['alert.evidence_truncated']");
    expect(params).toMatchObject({
      limit: 200,
      fromTime: "2026-06-01T00:00:00Z",
      toTime: "2026-06-16T00:00:00Z",
    });
  });

  const baseRawRow = {
    timestamp: "2026-06-10T00:00:00Z",
    eventType: "instance_fired",
    slug: "high-5xx",
    instanceFingerprint: "fp1",
    instanceLabelsJson: '{"host":"web-1"}',
    severity: "",
    suppressed: "false",
    silenced: "",
    deliveryTargetsRaw: "",
    evidenceJson: "",
    evidenceTruncated: "false",
  };

  async function runWithRawRow(overrides: Record<string, string>) {
    const ch = vi.fn().mockResolvedValue([{ ...baseRawRow, ...overrides }]);
    const [row] = await queryAlertEventLog(ch, {
      limit: 200,
      fromISO: "2026-06-01T00:00:00Z",
      toISO: "2026-06-16T00:00:00Z",
    });
    return row;
  }

  it("maps attributes onto the row shape", async () => {
    const row = await runWithRawRow({});
    expect(row).toMatchObject({
      timestamp: "2026-06-10T00:00:00Z",
      eventType: "instance_fired",
      slug: "high-5xx",
      instanceFingerprint: "fp1",
      labels: { host: "web-1" },
      severity: "",
      suppressed: false,
      silenced: false,
      deliveryTargets: [],
      evidence: null,
      evidenceTruncated: false,
    });
  });

  it("collapses malformed or non-object instance labels to {}", async () => {
    expect(
      (await runWithRawRow({ instanceLabelsJson: "{oops" })).labels,
    ).toEqual({});
    expect(
      (await runWithRawRow({ instanceLabelsJson: "[1,2]" })).labels,
    ).toEqual({});
    expect((await runWithRawRow({ instanceLabelsJson: "" })).labels).toEqual(
      {},
    );
  });

  it("stringifies non-string label values instead of dropping them", async () => {
    const row = await runWithRawRow({
      instanceLabelsJson: '{"host":"web-1","code":500}',
    });
    expect(row.labels).toEqual({ host: "web-1", code: "500" });
  });

  it("maps suppressed and silenced flags to booleans (literal 'true' only)", async () => {
    expect((await runWithRawRow({ suppressed: "true" })).suppressed).toBe(true);
    expect((await runWithRawRow({ suppressed: "" })).suppressed).toBe(false);
    expect((await runWithRawRow({ silenced: "true" })).silenced).toBe(true);
    expect((await runWithRawRow({ silenced: "false" })).silenced).toBe(false);
  });

  it("parses comma-joined delivery targets (CC's current shape)", async () => {
    const row = await runWithRawRow({
      deliveryTargetsRaw: "ops-slack, pagerduty-primary",
    });
    expect(row.deliveryTargets).toEqual(["ops-slack", "pagerduty-primary"]);
  });

  it("parses JSON-array and JSON-object delivery targets (older shapes)", async () => {
    expect(
      (await runWithRawRow({ deliveryTargetsRaw: '["a","b"]' }))
        .deliveryTargets,
    ).toEqual(["a", "b"]);
    expect(
      (await runWithRawRow({ deliveryTargetsRaw: '{"slack":["ops"]}' }))
        .deliveryTargets,
    ).toEqual(["slack:ops"]);
  });

  it("treats malformed delivery targets as a comma-joined string", async () => {
    const row = await runWithRawRow({ deliveryTargetsRaw: "{not json" });
    expect(row.deliveryTargets).toEqual(["{not json"]);
  });

  it("parses evidence with the same defensive rules as the per-slug reader", async () => {
    expect(
      (await runWithRawRow({ evidenceJson: '{"count":42}' })).evidence,
    ).toEqual({ count: 42 });
    expect(
      (await runWithRawRow({ evidenceJson: "{oops" })).evidence,
    ).toBeNull();
  });

  it("maps the evidence_truncated flag to a boolean", async () => {
    expect(
      (await runWithRawRow({ evidenceTruncated: "true" })).evidenceTruncated,
    ).toBe(true);
    expect(
      (await runWithRawRow({ evidenceTruncated: "false" })).evidenceTruncated,
    ).toBe(false);
  });

  it("does not leak raw projection fields onto the mapped row", async () => {
    const row = await runWithRawRow({});
    expect(row).not.toHaveProperty("instanceLabelsJson");
    expect(row).not.toHaveProperty("deliveryTargetsRaw");
    expect(row).not.toHaveProperty("evidenceJson");
  });
});
