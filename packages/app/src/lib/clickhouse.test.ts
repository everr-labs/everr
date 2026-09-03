import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockQuery,
  mockInsert,
  mockCommand,
  mockJson,
  mockInstrumentClickhouseOperation,
  MASTER_KEY,
} = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockInsert: vi.fn(),
  mockCommand: vi.fn(),
  mockJson: vi.fn(),
  mockInstrumentClickhouseOperation: vi.fn(
    async (_attributes: unknown, run: () => Promise<unknown>) => run(),
  ),
  MASTER_KEY: "test-master-key-must-be-at-least-32-chars-long",
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
    CLICKHOUSE_SQL_API_MASTER_KEY: MASTER_KEY,
  },
}));

vi.mock("@/telemetry/clickhouse", () => ({
  instrumentClickhouseOperation: mockInstrumentClickhouseOperation,
}));

vi.unmock("@/lib/clickhouse");

import {
  deprovisionSqlApiOrgUser,
  insertAdminRows,
  provisionSqlApiOrgUser,
  query,
  querySqlApi,
  querySqlApiWithMeta,
  seedDefaultRetention,
  upsertTenantRetention,
} from "./clickhouse";
import { resolveRetention } from "./retention";

const ORG = "org42";
const ORG_USER = `sql_api_org_${ORG}`;
const ORG_PASSWORD = `${createHmac("sha256", MASTER_KEY)
  .update(ORG)
  .digest("hex")}A!`;

beforeEach(() => {
  vi.clearAllMocks();
  mockInstrumentClickhouseOperation.mockImplementation(
    async (_attributes: unknown, run: () => Promise<unknown>) => run(),
  );
  mockJson.mockReturnValue([]);
  mockQuery.mockResolvedValue({ json: mockJson });
  mockCommand.mockResolvedValue(undefined);
});

describe("query", () => {
  it("wraps app ClickHouse reads in telemetry", async () => {
    await query("SELECT {n:UInt8}", ORG, { n: 1 });

    expect(mockInstrumentClickhouseOperation).toHaveBeenCalledWith(
      {
        client: "app",
        operation: "QUERY",
      },
      expect.any(Function),
    );
  });
});

describe("querySqlApi", () => {
  it("authenticates per-query as the org user and forwards query params", async () => {
    await querySqlApi("SELECT {n:UInt8}", ORG, { n: 1 });

    expect(mockInstrumentClickhouseOperation).toHaveBeenCalledWith(
      {
        client: "sql_api",
        operation: "QUERY",
      },
      expect.any(Function),
    );
    expect(mockQuery).toHaveBeenCalledWith({
      query: "SELECT {n:UInt8}",
      query_params: { n: 1 },
      format: "JSONEachRow",
      auth: { username: ORG_USER, password: ORG_PASSWORD },
      http_headers: { "X-ClickHouse-Quota": ORG_USER },
    });
    // Per-org user provisioning happens at org creation (auth.server.ts), never
    // on the read path.
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

describe("querySqlApiWithMeta", () => {
  it("uses JSON format so column metadata is available for empty results", async () => {
    mockJson.mockResolvedValueOnce({
      meta: [{ name: "route" }, { name: "n" }],
      data: [],
    });

    await expect(querySqlApiWithMeta("SELECT 1", ORG)).resolves.toEqual({
      rows: [],
      columns: ["route", "n"],
    });

    expect(mockQuery).toHaveBeenCalledWith({
      query: "SELECT 1",
      query_params: undefined,
      format: "JSON",
      auth: { username: ORG_USER, password: ORG_PASSWORD },
      http_headers: { "X-ClickHouse-Quota": ORG_USER },
    });
  });
});

describe("upsertTenantRetention", () => {
  it("writes the tier's retention row through the admin client", async () => {
    const pro = resolveRetention("pro");
    const updatedAt = new Date("2026-09-03T10:00:00.123Z");
    await upsertTenantRetention({ tenantId: ORG, tier: "pro", updatedAt });

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        table: "app.tenant_retention_source",
        values: [
          {
            tenant_id: ORG,
            traces_days: pro.tracesDays,
            logs_days: pro.logsDays,
            metrics_days: pro.metricsDays,
            // Epoch milliseconds: the row's version keeps the sub-second
            // precision that decides which of two concurrent writes wins.
            updated_at: updatedAt.getTime(),
          },
        ],
      }),
    );
  });
});

describe("seedDefaultRetention", () => {
  it("writes the free tier under the empty tenant id", async () => {
    const free = resolveRetention("free");
    await seedDefaultRetention();

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        table: "app.tenant_retention_source",
        values: [
          {
            tenant_id: "",
            traces_days: free.tracesDays,
            logs_days: free.logsDays,
            metrics_days: free.metricsDays,
            updated_at: expect.any(Number),
          },
        ],
      }),
    );
  });
});

describe("insertAdminRows", () => {
  it("writes rows through the admin client with the given settings", async () => {
    await insertAdminRows(
      "app.alert_events",
      [
        {
          tenant_id: ORG,
          alert_definition_id: "alert-1",
          repoid: "repo-1",
          slug: "high-5xx",
          event_type: "firing",
        },
      ],
      { async_insert: 1, wait_for_async_insert: 1 },
    );

    expect(mockInsert).toHaveBeenCalledWith({
      table: "app.alert_events",
      values: [
        {
          tenant_id: ORG,
          alert_definition_id: "alert-1",
          repoid: "repo-1",
          slug: "high-5xx",
          event_type: "firing",
        },
      ],
      format: "JSONEachRow",
      clickhouse_settings: {
        async_insert: 1,
        wait_for_async_insert: 1,
      },
    });
  });

  it("does not issue an insert for an empty batch", async () => {
    await insertAdminRows("app.alert_events", []);

    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe("provisionSqlApiOrgUser", () => {
  it("creates the org user, grants sql_api_role, and creates per-table row policies", async () => {
    await provisionSqlApiOrgUser(ORG);

    const calls = mockCommand.mock.calls.map(([args]) => args.query);
    expect(calls).toEqual([
      `CREATE USER IF NOT EXISTS \`${ORG_USER}\` IDENTIFIED WITH sha256_password BY '${ORG_PASSWORD}' SETTINGS PROFILE 'sql_api_profile'`,
      "SET ROLE sql_api_role",
      `GRANT sql_api_role TO \`${ORG_USER}\``,
      `ALTER USER \`${ORG_USER}\` DEFAULT ROLE sql_api_role`,
      `CREATE ROW POLICY IF NOT EXISTS \`${ORG_USER}_traces\` ON app.\`traces\` FOR SELECT USING tenant_id = '${ORG}' TO \`${ORG_USER}\``,
      `CREATE ROW POLICY IF NOT EXISTS \`${ORG_USER}_logs\` ON app.\`logs\` FOR SELECT USING tenant_id = '${ORG}' TO \`${ORG_USER}\``,
      `CREATE ROW POLICY IF NOT EXISTS \`${ORG_USER}_metrics_gauge\` ON app.\`metrics_gauge\` FOR SELECT USING tenant_id = '${ORG}' TO \`${ORG_USER}\``,
      `CREATE ROW POLICY IF NOT EXISTS \`${ORG_USER}_metrics_sum\` ON app.\`metrics_sum\` FOR SELECT USING tenant_id = '${ORG}' TO \`${ORG_USER}\``,
      `CREATE ROW POLICY IF NOT EXISTS \`${ORG_USER}_metrics_histogram\` ON app.\`metrics_histogram\` FOR SELECT USING tenant_id = '${ORG}' TO \`${ORG_USER}\``,
      `CREATE ROW POLICY IF NOT EXISTS \`${ORG_USER}_metrics_exponential_histogram\` ON app.\`metrics_exponential_histogram\` FOR SELECT USING tenant_id = '${ORG}' TO \`${ORG_USER}\``,
      `CREATE ROW POLICY IF NOT EXISTS \`${ORG_USER}_metrics_summary\` ON app.\`metrics_summary\` FOR SELECT USING tenant_id = '${ORG}' TO \`${ORG_USER}\``,
    ]);

    const setRoleCall = mockCommand.mock.calls[1][0];
    const grantCall = mockCommand.mock.calls[2][0];
    expect(mockInstrumentClickhouseOperation.mock.calls[0][0]).toEqual({
      client: "admin",
      operation: "QUERY",
    });
    expect(setRoleCall.clickhouse_settings.session_id).toBeDefined();
    expect(grantCall.clickhouse_settings.session_id).toBe(
      setRoleCall.clickhouse_settings.session_id,
    );
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
      `DROP ROW POLICY IF EXISTS \`${ORG_USER}_metrics_histogram\` ON app.\`metrics_histogram\``,
      `DROP ROW POLICY IF EXISTS \`${ORG_USER}_metrics_exponential_histogram\` ON app.\`metrics_exponential_histogram\``,
      `DROP ROW POLICY IF EXISTS \`${ORG_USER}_metrics_summary\` ON app.\`metrics_summary\``,
      `DROP USER IF EXISTS \`${ORG_USER}\``,
    ]);
  });
});
