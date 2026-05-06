import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery, mockInsert, mockJson } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockInsert: vi.fn(),
  mockJson: vi.fn(),
}));

vi.mock("@clickhouse/client", () => ({
  createClient: vi.fn(() => ({
    query: mockQuery,
    insert: mockInsert,
  })),
}));

vi.mock("@/env", () => ({
  env: {
    CLICKHOUSE_URL: "http://localhost:8123",
    CLICKHOUSE_USERNAME: "default",
    CLICKHOUSE_PASSWORD: "password",
    CLICKHOUSE_DATABASE: "default",
    CLICKHOUSE_RETENTION_USERNAME: "retention",
    CLICKHOUSE_RETENTION_PASSWORD: "retention-password",
    CLICKHOUSE_SQL_API_USERNAME: "sql_api_user",
    CLICKHOUSE_SQL_API_PASSWORD: "sql-api-password",
  },
}));

vi.unmock("@/lib/clickhouse");

import { querySqlApi } from "./clickhouse";

beforeEach(() => {
  vi.clearAllMocks();
  mockJson.mockReturnValue([]);
  mockQuery.mockResolvedValue({ json: mockJson });
});

describe("querySqlApi", () => {
  it("injects only the tenant id and forwards query params", async () => {
    await querySqlApi("SELECT {n:UInt8}", "org-42", { n: 1 });

    expect(mockQuery).toHaveBeenCalledWith({
      query: "SELECT {n:UInt8}",
      query_params: { n: 1 },
      format: "JSONEachRow",
      clickhouse_settings: {
        SQL_everr_tenant_id: "org-42",
      },
    });
  });

  it("rejects when tenant id is missing", async () => {
    await expect(querySqlApi("SELECT 1", "")).rejects.toThrow(
      /tenant context/i,
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
