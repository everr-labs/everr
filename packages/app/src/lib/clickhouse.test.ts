import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

const ORG42_ROLE =
  "sql_api_org_e57e356a802a92d3abc46b1ee4546567f787933f3db939fc7d623b8f6889ca65";
const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const SQL_API_BACKFILL_SQL = readFileSync(
  resolve(CURRENT_DIR, "../../../../clickhouse/backfill-sql-api-access.sql"),
  "utf8",
);

beforeEach(() => {
  vi.clearAllMocks();
  mockJson.mockReturnValue([]);
  mockQuery.mockResolvedValue({ json: mockJson });
  mockCommand.mockResolvedValue(undefined);
});

describe("querySqlApi", () => {
  it("activates sql_api_role + the per-org role and forwards query params", async () => {
    await querySqlApi("SELECT {n:UInt8}", "org42", { n: 1 });

    expect(mockCommand).toHaveBeenCalledWith({
      query: `CREATE ROLE IF NOT EXISTS \`${ORG42_ROLE}\``,
    });
    expect(mockQuery).toHaveBeenCalledWith({
      query: "SELECT {n:UInt8}",
      query_params: { n: 1 },
      format: "JSONEachRow",
      role: ["sql_api_role", ORG42_ROLE],
      http_headers: { "X-ClickHouse-Quota": ORG42_ROLE },
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
  it("creates the opaque role, the per-table policies, and grants the role to sql_api_user", async () => {
    await provisionSqlApiOrgRole("org42");

    const calls = mockCommand.mock.calls.map(([args]) => args.query);
    expect(calls).toEqual([
      `CREATE ROLE IF NOT EXISTS \`${ORG42_ROLE}\``,
      `CREATE ROW POLICY IF NOT EXISTS \`${ORG42_ROLE}_traces\` ON app.\`traces\` FOR SELECT USING tenant_id = 'org42' TO \`${ORG42_ROLE}\``,
      `CREATE ROW POLICY IF NOT EXISTS \`${ORG42_ROLE}_logs\` ON app.\`logs\` FOR SELECT USING tenant_id = 'org42' TO \`${ORG42_ROLE}\``,
      `CREATE ROW POLICY IF NOT EXISTS \`${ORG42_ROLE}_metrics_gauge\` ON app.\`metrics_gauge\` FOR SELECT USING tenant_id = 'org42' TO \`${ORG42_ROLE}\``,
      `CREATE ROW POLICY IF NOT EXISTS \`${ORG42_ROLE}_metrics_sum\` ON app.\`metrics_sum\` FOR SELECT USING tenant_id = 'org42' TO \`${ORG42_ROLE}\``,
      `GRANT \`${ORG42_ROLE}\` TO sql_api_user`,
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
  it("drops the per-table policies, then the opaque role", async () => {
    await deprovisionSqlApiOrgRole("org42");

    const calls = mockCommand.mock.calls.map(([args]) => args.query);
    expect(calls).toEqual([
      `DROP ROW POLICY IF EXISTS \`${ORG42_ROLE}_traces\` ON app.\`traces\``,
      `DROP ROW POLICY IF EXISTS \`${ORG42_ROLE}_logs\` ON app.\`logs\``,
      `DROP ROW POLICY IF EXISTS \`${ORG42_ROLE}_metrics_gauge\` ON app.\`metrics_gauge\``,
      `DROP ROW POLICY IF EXISTS \`${ORG42_ROLE}_metrics_sum\` ON app.\`metrics_sum\``,
      `DROP ROLE IF EXISTS \`${ORG42_ROLE}\``,
    ]);
  });
});

describe("manual SQL API access backfill SQL", () => {
  it("creates missing users, role/profile/quota, grants, and default-deny policies", () => {
    expect(SQL_API_BACKFILL_SQL).toMatch(
      /\bCREATE USER IF NOT EXISTS web_app_admin\b/i,
    );
    expect(SQL_API_BACKFILL_SQL).toMatch(
      /\bCREATE USER IF NOT EXISTS sql_api_user\b/i,
    );
    expect(SQL_API_BACKFILL_SQL).toMatch(
      /\bCREATE SETTINGS PROFILE IF NOT EXISTS sql_api_profile\b/i,
    );
    expect(SQL_API_BACKFILL_SQL).toMatch(
      /\bCREATE ROLE IF NOT EXISTS sql_api_role\b/i,
    );
    expect(SQL_API_BACKFILL_SQL).toMatch(
      /\bCREATE QUOTA OR REPLACE sql_api_quota\b/i,
    );
    expect(SQL_API_BACKFILL_SQL).toMatch(
      /\bCREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_traces\b/i,
    );
    expect(SQL_API_BACKFILL_SQL).toMatch(
      /\bGRANT CREATE ROLE, DROP ROLE ON \*\.\* TO web_app_admin\b/i,
    );
    expect(SQL_API_BACKFILL_SQL).toMatch(
      /\bGRANT sql_api_role TO sql_api_user\b/i,
    );
  });

  it("keeps the passwords as manual replacement placeholders", () => {
    expect(SQL_API_BACKFILL_SQL).toContain("<WEB_APP_ADMIN_PASSWORD>");
    expect(SQL_API_BACKFILL_SQL).toContain("<SQL_API_PASSWORD>");
  });
});
