import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery, mockInsert, mockCommand, mockJson } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockInsert: vi.fn(),
  mockCommand: vi.fn(),
  mockJson: vi.fn(),
}));

vi.mock("@clickhouse/client", () => ({
  createClient: vi.fn(() => ({
    query: mockQuery,
    insert: mockInsert,
    command: mockCommand,
  })),
}));

vi.mock("@/env", () => ({
  env: {
    CLICKHOUSE_URL: "http://localhost:8123",
    CLICKHOUSE_USERNAME: "default",
    CLICKHOUSE_PASSWORD: "password",
    CLICKHOUSE_DATABASE: "default",
    CLICKHOUSE_ADMIN_USERNAME: "web_app_admin",
    CLICKHOUSE_ADMIN_PASSWORD: "web-app-admin-password",
    CLICKHOUSE_SQL_API_USERNAME: "sql_api_user",
    CLICKHOUSE_SQL_API_PASSWORD: "sql-api-password",
  },
}));

vi.unmock("@/lib/clickhouse");

import {
  deprovisionSqlApiOrgRole,
  provisionSqlApiOrgRole,
  querySqlApi,
} from "./clickhouse";

beforeEach(() => {
  vi.clearAllMocks();
  mockJson.mockReturnValue([]);
  mockQuery.mockResolvedValue({ json: mockJson });
  mockCommand.mockResolvedValue(undefined);
});

describe("querySqlApi", () => {
  it("activates sql_api_role + the per-org role and forwards query params", async () => {
    await querySqlApi("SELECT {n:UInt8}", "org42", { n: 1 });

    expect(mockQuery).toHaveBeenCalledWith({
      query: "SELECT {n:UInt8}",
      query_params: { n: 1 },
      format: "JSONEachRow",
      role: ["sql_api_role", "sql_api_org_org42"],
    });
  });

  it("rejects when tenant id is missing", async () => {
    await expect(querySqlApi("SELECT 1", "")).rejects.toThrow(
      /tenant context/i,
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects an organization id that wouldn't be safe in an identifier", async () => {
    await expect(
      querySqlApi("SELECT 1", "org`; DROP ROLE sql_api_role; --"),
    ).rejects.toThrow(/unsafe organization id/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("provisionSqlApiOrgRole", () => {
  it("creates the role, the per-table policies, and grants the role to sql_api_user", async () => {
    await provisionSqlApiOrgRole("org42");

    const calls = mockCommand.mock.calls.map(([args]) => args.query);
    expect(calls).toEqual([
      "CREATE ROLE IF NOT EXISTS `sql_api_org_org42`",
      "CREATE ROW POLICY IF NOT EXISTS `sql_api_org_org42_traces` ON app.`traces` FOR SELECT USING tenant_id = 'org42' TO `sql_api_org_org42`",
      "CREATE ROW POLICY IF NOT EXISTS `sql_api_org_org42_logs` ON app.`logs` FOR SELECT USING tenant_id = 'org42' TO `sql_api_org_org42`",
      "CREATE ROW POLICY IF NOT EXISTS `sql_api_org_org42_metrics_gauge` ON app.`metrics_gauge` FOR SELECT USING tenant_id = 'org42' TO `sql_api_org_org42`",
      "CREATE ROW POLICY IF NOT EXISTS `sql_api_org_org42_metrics_sum` ON app.`metrics_sum` FOR SELECT USING tenant_id = 'org42' TO `sql_api_org_org42`",
      "GRANT `sql_api_org_org42` TO sql_api_user",
    ]);
  });

  it("rejects an unsafe organization id before any DDL runs", async () => {
    await expect(provisionSqlApiOrgRole("evil id")).rejects.toThrow(
      /unsafe organization id/i,
    );
    expect(mockCommand).not.toHaveBeenCalled();
  });
});

describe("deprovisionSqlApiOrgRole", () => {
  it("drops the per-table policies, then the role", async () => {
    await deprovisionSqlApiOrgRole("org42");

    const calls = mockCommand.mock.calls.map(([args]) => args.query);
    expect(calls).toEqual([
      "DROP ROW POLICY IF EXISTS `sql_api_org_org42_traces` ON app.`traces`",
      "DROP ROW POLICY IF EXISTS `sql_api_org_org42_logs` ON app.`logs`",
      "DROP ROW POLICY IF EXISTS `sql_api_org_org42_metrics_gauge` ON app.`metrics_gauge`",
      "DROP ROW POLICY IF EXISTS `sql_api_org_org42_metrics_sum` ON app.`metrics_sum`",
      "DROP ROLE IF EXISTS `sql_api_org_org42`",
    ]);
  });
});
