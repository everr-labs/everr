import { beforeEach, expect, it, vi } from "vite-plus/test";
import { observeTraceDetail, observeTraceQuery } from "./consultation-completion";

const { observe, log } = vi.hoisted(() => ({ observe: vi.fn(), log: vi.fn() }));
vi.mock("#app/server/organizations/consultations.ts", () => ({ consultations: { observe } }));
vi.mock("#app/telemetry/logger.ts", () => ({ serverLogger: { error: log } }));
const principal = {
  kind: "client",
  organizationId: "own",
  clientId: "authorized-analysis",
} as const;
const traceId = "0123456789abcdef0123456789abcdef";
const sql = `SELECT * FROM traces WHERE TraceId = '${traceId}' LIMIT 100`;
const row = {
  TraceId: traceId,
  ServiceName: "checkout",
  ResourceAttributes: { deployment: { environment: { name: "production" } } },
  SpanAttributes: {},
};
const uiRow = {
  traceId,
  serviceName: "checkout",
  resourceAttributes: { "deployment.environment.name": "production" },
  spanAttributes: {},
};
beforeEach(() => {
  observe.mockReset();
  log.mockReset();
});

it("accepts an exact raw trace consultation without inventing a User", () => {
  observeTraceQuery({ principal, surface: "cli", sql, rows: [row] });
  expect(observe).toHaveBeenCalledExactlyOnceWith({
    principal,
    surface: "cli",
    traces: [{ ...uiRow, resourceAttributes: row.ResourceAttributes }],
  });
});

it("forwards completed trace metadata without Cloud provenance rules", () => {
  const member = { kind: "member", organizationId: "own", userId: "u", membershipId: "m" } as const;
  const traces = [
    { ...uiRow, serviceName: "demo", resourceAttributes: { "everr.synthetic": true } },
  ];
  observeTraceDetail({ principal: member, rows: traces });
  expect(observe).toHaveBeenCalledExactlyOnceWith({ principal: member, surface: "ui", traces });
});

it.each([
  "SELECT 1",
  "SHOW TABLES",
  "DESCRIBE traces",
  "SELECT count() FROM traces",
  "SELECT * FROM traces LIMIT 1",
  `SELECT '${traceId}' AS TraceId, 'checkout' AS ServiceName, map('deployment.environment.name', 'production') AS ResourceAttributes`,
  sql.replace(
    "*",
    "* REPLACE (map('deployment.environment.name', 'production') AS ResourceAttributes)",
  ),
  sql + " UNION ALL SELECT * FROM traces",
  sql + " SETTINGS SQL_everr_tenant_id = 'other'",
  sql.replace("traces", "system.tables"),
  sql.replace("traces", "(SELECT * FROM traces)"),
  sql.replace("traces", "traces AS x"),
  sql.replace("100", "1001"),
  sql.replace("LIMIT", "OR 1=1 LIMIT"),
  sql + "; SELECT 1",
  "/*probe*/ " + sql,
])("does not observe SQL outside its complete grammar: %s", (query) => {
  observeTraceQuery({ principal, surface: "cli", sql: query, rows: [row] });
  expect(observe).not.toHaveBeenCalled();
});

it("does not observe empty results or a different trace", () => {
  observeTraceQuery({ principal, surface: "cli", sql, rows: [] });
  observeTraceQuery({ principal, surface: "cli", sql, rows: [{ ...row, TraceId: "other" }] });
  expect(observe).not.toHaveBeenCalled();
});

it("contains observation and diagnostic failures without leaking query, evidence or exceptions", () => {
  observe.mockImplementation(() => {
    throw new Error("private-content");
  });
  expect(() => observeTraceQuery({ principal, surface: "cli", sql, rows: [row] })).not.toThrow();
  expect(log).toHaveBeenCalledExactlyOnceWith("organization.consultations.failed", {
    "everr.consultation.failure_stage": "completion",
  });
  log.mockImplementation(() => {
    throw new Error("logger-down");
  });
  expect(() => observeTraceQuery({ principal, surface: "cli", sql, rows: [row] })).not.toThrow();
});

it("accepts the bounded service/time variant without changing SQL execution", () => {
  const bounded = sql.replace(
    " LIMIT",
    " AND ServiceName = 'checkout' AND Timestamp >= '2026-10-23 00:00:00' AND Timestamp < '2026-10-24 00:00:00' ORDER BY Timestamp ASC LIMIT",
  );
  observeTraceQuery({ principal, surface: "cli", sql: bounded, rows: [row] });
  expect(observe).toHaveBeenCalledTimes(1);
});
