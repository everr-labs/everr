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
  },
}));

vi.unmock("@/lib/clickhouse");

import { queryWithClickHouseSettings } from "./clickhouse";

beforeEach(() => {
  vi.clearAllMocks();
  mockJson.mockReturnValue([]);
  mockQuery.mockResolvedValue({ json: mockJson });
});

describe("queryWithClickHouseSettings", () => {
  it("does not allow clickhouseSettings to override tenant context", async () => {
    await queryWithClickHouseSettings("SELECT 1", "org-42", {
      max_result_rows: 500,
      SQL_everr_tenant_id: "org-override",
    });

    expect(mockQuery).toHaveBeenCalledWith({
      query: "SELECT 1",
      query_params: undefined,
      format: "JSONEachRow",
      clickhouse_settings: {
        max_result_rows: 500,
        SQL_everr_tenant_id: "org-42",
      },
    });
  });
});
