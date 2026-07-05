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
    expect(params).toMatchObject({
      slug: "high-5xx",
      limit: 50,
      fromTime: "2026-06-01T00:00:00Z",
      toTime: "2026-06-16T00:00:00Z",
    });
  });
});
