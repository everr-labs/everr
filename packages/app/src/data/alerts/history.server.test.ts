import { describe, expect, it, vi } from "vitest";
import {
  queryAlertEventLog,
  queryObservedLabelKeys,
  queryObservedLabelValues,
} from "./history.server";

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

  it("parses evidence defensively (object, else null)", async () => {
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

describe("queryObservedLabelKeys", () => {
  it("extracts instance-label keys by frequency with no tenant filter in SQL", async () => {
    const ch = vi.fn().mockResolvedValue([{ key: "svc" }, { key: "host" }]);
    const keys = await queryObservedLabelKeys(ch, {
      limit: 100,
      fromISO: "2026-06-01T00:00:00Z",
      toISO: "2026-06-08T00:00:00Z",
    });
    expect(keys).toEqual(["svc", "host"]);
    const [sql, params] = ch.mock.calls[0];
    expect(sql).toContain("FROM app.logs");
    expect(sql).toContain("ServiceName = 'alert'");
    expect(sql).toContain("ScopeName = 'everr.alerting'");
    expect(sql).toContain(
      "arrayJoin(JSONExtractKeys(LogAttributes['alert.instance_labels']))",
    );
    expect(sql).toContain("ORDER BY count() DESC");
    expect(sql).toContain("LIMIT {limit:UInt32}");
    // Tenancy comes from the row-level policy, never a SQL org filter.
    expect(sql).not.toMatch(/organization|tenant_id/);
    expect(params).toMatchObject({
      limit: 100,
      fromTime: "2026-06-01T00:00:00Z",
      toTime: "2026-06-08T00:00:00Z",
    });
  });
});

describe("queryObservedLabelValues", () => {
  it("extracts one key's values by frequency, skipping rows without the key", async () => {
    const ch = vi.fn().mockResolvedValue([{ value: "flap" }]);
    const values = await queryObservedLabelValues(ch, "svc", {
      limit: 100,
      fromISO: "2026-06-01T00:00:00Z",
      toISO: "2026-06-08T00:00:00Z",
    });
    expect(values).toEqual(["flap"]);
    const [sql, params] = ch.mock.calls[0];
    expect(sql).toContain(
      "JSONExtractString(LogAttributes['alert.instance_labels'], {key:String})",
    );
    // Absent keys extract as '' — those rows are noise, not a value.
    expect(sql).toContain("value != ''");
    expect(sql).toContain("ORDER BY count() DESC");
    expect(sql).not.toMatch(/organization|tenant_id/);
    expect(params).toMatchObject({ key: "svc", limit: 100 });
  });
});
