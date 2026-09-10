import { describe, expect, it } from "vitest";
import { buildDetailQuery, mapDetailRow } from "./detail";

describe("buildDetailQuery", () => {
  it("matches by timestamp + identity components", () => {
    const built = buildDetailQuery({
      timestampRaw: "2026-03-09 12:00:00",
      traceId: "t",
      spanId: "s",
      serviceName: "svc",
      bodyHash: "h",
    });
    expect(built.sql).toContain("FROM logs");
    expect(built.sql).toContain("LIMIT 1");
    expect(built.params.traceId).toBe("t");
    expect(built.params.bodyHash).toBe("h");
  });
});

describe("mapDetailRow", () => {
  it("normalizes timestamp + coerces severity", () => {
    const detail = mapDetailRow({
      timestampRaw: "2026-03-09 12:00:00",
      level: "error",
      severityText: "ERROR",
      severityNumber: "17",
      serviceName: "svc",
      traceId: "t",
      spanId: "s",
      resourceAttributes: { a: "b" },
      logAttributes: {},
      scopeAttributes: {},
    });
    expect(detail.severityNumber).toBe(17);
    expect(detail.timestamp).toMatch(/^2026-03-09T12:00:00/);
  });

  it("flattens the nested JSON attributes into dotted keys", () => {
    const detail = mapDetailRow({
      timestampRaw: "2026-09-07 10:00:00.000000000",
      level: "info",
      severityText: "INFO",
      severityNumber: 9,
      serviceName: "api",
      traceId: "",
      spanId: "",
      resourceAttributes: { service: { name: "api" } },
      logAttributes: { http: { response: { status_code: 500 } } },
      scopeAttributes: null,
    });
    expect(detail.resourceAttributes).toEqual({ "service.name": "api" });
    expect(detail.logAttributes).toEqual({
      "http.response.status_code": "500",
    });
    expect(detail.scopeAttributes).toEqual({});
  });
});
