import { beforeEach, describe, expect, it, vi } from "vitest";
import { insertAdminRows } from "@/lib/clickhouse";
import { createCloudLogEventEmitter } from "./log-event-emitter";

vi.mock("@/lib/clickhouse", () => ({
  insertAdminRows: vi.fn(async () => {}),
}));

beforeEach(() => {
  vi.mocked(insertAdminRows).mockClear();
});

describe("createCloudLogEventEmitter", () => {
  it("rejects a missing tenant", () => {
    expect(() => createCloudLogEventEmitter({ tenantId: "" })).toThrow(
      "Missing tenant",
    );
  });

  it("inserts a log row into the OTLP staging table with the tenant stamped", async () => {
    const emitter = createCloudLogEventEmitter({ tenantId: "org-1" });
    await emitter.emit({
      serviceName: "everr-triage",
      body: "## Findings",
      attributes: {
        "everr.error.event": "investigation",
        "everr.error.fingerprint": "fp-1",
      },
    });

    expect(insertAdminRows).toHaveBeenCalledTimes(1);
    const [table, rows, settings] = vi.mocked(insertAdminRows).mock
      .calls[0] as [string, Record<string, unknown>[], unknown];
    expect(table).toBe("otel.otel_logs");
    expect(settings).toEqual({ date_time_input_format: "best_effort" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      SeverityText: "INFO",
      SeverityNumber: 9,
      ServiceName: "everr-triage",
      Body: "## Findings",
      ResourceAttributes: {
        "service.name": "everr-triage",
        "everr.tenant.id": "org-1",
      },
      LogAttributes: {
        "everr.error.event": "investigation",
        "everr.error.fingerprint": "fp-1",
      },
    });
    expect(Date.parse(rows[0]?.Timestamp as string)).not.toBeNaN();
  });

  it("never lets an event override the tenant resource attribute", async () => {
    const emitter = createCloudLogEventEmitter({ tenantId: "org-1" });
    await emitter.emit({
      serviceName: "everr-triage",
      body: "spoof attempt",
      attributes: {},
      resourceAttributes: { "everr.tenant.id": "victim-org", region: "eu" },
    });

    const [, rows] = vi.mocked(insertAdminRows).mock.calls[0] as [
      string,
      Record<string, unknown>[],
    ];
    expect(rows[0]?.ResourceAttributes).toEqual({
      "service.name": "everr-triage",
      region: "eu",
      "everr.tenant.id": "org-1",
    });
  });

  it("honors explicit severity overrides", async () => {
    const emitter = createCloudLogEventEmitter({ tenantId: "org-1" });
    await emitter.emit({
      serviceName: "everr-triage",
      body: "warn event",
      attributes: {},
      severityText: "WARN",
      severityNumber: 13,
    });

    const [, rows] = vi.mocked(insertAdminRows).mock.calls[0] as [
      string,
      Record<string, unknown>[],
    ];
    expect(rows[0]).toMatchObject({ SeverityText: "WARN", SeverityNumber: 13 });
  });
});
