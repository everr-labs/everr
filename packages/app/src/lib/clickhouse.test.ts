import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery, mockInsert, mockCommand, mockJson, MASTER_KEY } = vi.hoisted(
  () => ({
    mockQuery: vi.fn(),
    mockInsert: vi.fn(),
    mockCommand: vi.fn(),
    mockJson: vi.fn(),
    MASTER_KEY: "test-master-key-must-be-at-least-32-chars-long",
  }),
);

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
    CLICKHOUSE_SQL_API_MASTER_KEY: MASTER_KEY,
  },
}));

vi.unmock("@/lib/clickhouse");

import {
  deprovisionSqlApiOrgUser,
  provisionSqlApiOrgUser,
  querySqlApi,
} from "./clickhouse";

const ORG = "org42";
const ORG_USER = `sql_api_org_${ORG}`;
const ORG_PASSWORD = `${createHmac("sha256", MASTER_KEY)
  .update(ORG)
  .digest("hex")}A!`;

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
  it("authenticates per-query as the org user and forwards query params", async () => {
    await querySqlApi("SELECT {n:UInt8}", ORG, { n: 1 });

    expect(mockQuery).toHaveBeenCalledWith({
      query: "SELECT {n:UInt8}",
      query_params: { n: 1 },
      format: "JSONEachRow",
      auth: { username: ORG_USER, password: ORG_PASSWORD },
      http_headers: { "X-ClickHouse-Quota": ORG_USER },
    });
    // Per-org user provisioning happens at org creation (auth.server.ts) and
    // in the startup backfill — never on the read path.
    expect(mockCommand).not.toHaveBeenCalled();
  });

  it("derives a deterministic password from the tenant id and the master key", async () => {
    await querySqlApi("SELECT 1", ORG);
    const firstAuth = mockQuery.mock.calls[0][0].auth;

    mockQuery.mockClear();
    await querySqlApi("SELECT 1", ORG);
    const secondAuth = mockQuery.mock.calls[0][0].auth;

    expect(firstAuth).toEqual(secondAuth);
    expect(firstAuth.password).toBe(ORG_PASSWORD);
  });

  it("rejects when tenant id is missing", async () => {
    await expect(querySqlApi("SELECT 1", "")).rejects.toThrow(
      /tenant context/i,
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("provisionSqlApiOrgUser", () => {
  it("creates the org user, grants sql_api_role, and creates per-table row policies", async () => {
    await provisionSqlApiOrgUser(ORG);

    const calls = mockCommand.mock.calls.map(([args]) => args.query);
    expect(calls).toEqual([
      `CREATE USER IF NOT EXISTS \`${ORG_USER}\` IDENTIFIED WITH sha256_password BY '${ORG_PASSWORD}' SETTINGS PROFILE 'sql_api_profile'`,
      `GRANT sql_api_role TO \`${ORG_USER}\``,
      `ALTER USER \`${ORG_USER}\` DEFAULT ROLE sql_api_role`,
      `CREATE ROW POLICY IF NOT EXISTS \`${ORG_USER}_traces\` ON app.\`traces\` FOR SELECT USING tenant_id = '${ORG}' TO \`${ORG_USER}\``,
      `CREATE ROW POLICY IF NOT EXISTS \`${ORG_USER}_logs\` ON app.\`logs\` FOR SELECT USING tenant_id = '${ORG}' TO \`${ORG_USER}\``,
      `CREATE ROW POLICY IF NOT EXISTS \`${ORG_USER}_metrics_gauge\` ON app.\`metrics_gauge\` FOR SELECT USING tenant_id = '${ORG}' TO \`${ORG_USER}\``,
      `CREATE ROW POLICY IF NOT EXISTS \`${ORG_USER}_metrics_sum\` ON app.\`metrics_sum\` FOR SELECT USING tenant_id = '${ORG}' TO \`${ORG_USER}\``,
    ]);
  });
});

describe("deprovisionSqlApiOrgUser", () => {
  it("drops the per-table policies before dropping the user", async () => {
    await deprovisionSqlApiOrgUser(ORG);

    const calls = mockCommand.mock.calls.map(([args]) => args.query);
    expect(calls).toEqual([
      `DROP ROW POLICY IF EXISTS \`${ORG_USER}_traces\` ON app.\`traces\``,
      `DROP ROW POLICY IF EXISTS \`${ORG_USER}_logs\` ON app.\`logs\``,
      `DROP ROW POLICY IF EXISTS \`${ORG_USER}_metrics_gauge\` ON app.\`metrics_gauge\``,
      `DROP ROW POLICY IF EXISTS \`${ORG_USER}_metrics_sum\` ON app.\`metrics_sum\``,
      `DROP USER IF EXISTS \`${ORG_USER}\``,
    ]);
  });
});

describe("manual SQL API access backfill SQL", () => {
  it("creates missing users, role/profile/quota, grants, and default-deny policies", () => {
    expect(SQL_API_BACKFILL_SQL).toMatch(
      /\bCREATE USER IF NOT EXISTS web_app_admin\b/i,
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
      /\bGRANT CREATE USER, ALTER USER, DROP USER ON \*\.\* TO web_app_admin\b/i,
    );
    expect(SQL_API_BACKFILL_SQL).toMatch(
      /\bGRANT sql_api_role TO web_app_admin WITH ADMIN OPTION\b/i,
    );
  });

  it("no longer references the shared sql_api_user or its password placeholder", () => {
    expect(SQL_API_BACKFILL_SQL).not.toMatch(/\bsql_api_user\b/);
    expect(SQL_API_BACKFILL_SQL).not.toContain("<SQL_API_PASSWORD>");
  });

  it("keeps the remaining password placeholders for manual replacement", () => {
    expect(SQL_API_BACKFILL_SQL).toContain("<COLLECTOR_RW_PASSWORD>");
    expect(SQL_API_BACKFILL_SQL).toContain("<APP_RO_PASSWORD>");
    expect(SQL_API_BACKFILL_SQL).toContain("<WEB_APP_ADMIN_PASSWORD>");
  });
});
