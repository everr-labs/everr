import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAppQuery, mockCliSqlQuery, mockJson, mockCreateClient } =
  vi.hoisted(() => {
    const mockAppQuery = vi.fn();
    const mockCliSqlQuery = vi.fn();
    const mockInsert = vi.fn();
    const mockJson = vi.fn();

    return {
      mockAppQuery,
      mockCliSqlQuery,
      mockInsert,
      mockJson,
      mockCreateClient: vi.fn((options: { username?: string }) => ({
        query: options.username === "cli_sql" ? mockCliSqlQuery : mockAppQuery,
        insert: mockInsert,
      })),
    };
  });

vi.mock("@clickhouse/client", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/env", () => ({
  env: {
    CLICKHOUSE_URL: "http://localhost:8123",
    CLICKHOUSE_USERNAME: "default",
    CLICKHOUSE_PASSWORD: "password",
    CLICKHOUSE_DATABASE: "default",
    CLICKHOUSE_CLI_SQL_USERNAME: "cli_sql",
    CLICKHOUSE_CLI_SQL_PASSWORD: "cli-sql-password",
    CLICKHOUSE_RETENTION_USERNAME: "retention",
    CLICKHOUSE_RETENTION_PASSWORD: "retention-password",
  },
}));

vi.unmock("@/lib/clickhouse");

import { queryWithClickHouseSettings } from "./clickhouse";

beforeEach(() => {
  vi.clearAllMocks();
  mockJson.mockReturnValue([]);
  mockAppQuery.mockResolvedValue({ json: mockJson });
  mockCliSqlQuery.mockResolvedValue({ json: mockJson });
});

describe("queryWithClickHouseSettings", () => {
  it("uses dedicated CLI SQL client and does not allow settings to override tenant context", async () => {
    await queryWithClickHouseSettings("SELECT 1", "org-42", {
      max_result_rows: 500,
      SQL_everr_tenant_id: "org-override",
    });

    expect(mockCliSqlQuery).toHaveBeenCalledWith({
      query: "SELECT 1",
      query_params: undefined,
      format: "JSONEachRow",
      clickhouse_settings: {
        max_result_rows: 500,
        SQL_everr_tenant_id: "org-42",
      },
    });
    expect(mockAppQuery).not.toHaveBeenCalled();
  });
});
