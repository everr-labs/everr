import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clickhouse", () => ({
  query: vi.fn(),
}));

import { query } from "@/lib/clickhouse";
import { getOrgUsage, getOrgUsageSeries } from "./usage";

const mockedQuery = vi.mocked(query);
const range = {
  from: "2026-08-01T00:00:00.123Z",
  to: "2026-09-01T00:00:00.123Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedQuery.mockResolvedValue([]);
});

describe("getOrgUsage", () => {
  it("re-aggregates tenant-scoped usage over a half-open range", async () => {
    mockedQuery.mockResolvedValueOnce([
      { meter: "logs", bytes: "1250000000", items: "42" },
      { meter: "traces", bytes: "750000000", items: "7" },
    ]);

    await expect(getOrgUsage({ data: range })).resolves.toEqual([
      { meter: "logs", bytes: 1_250_000_000, items: 42 },
      { meter: "traces", bytes: 750_000_000, items: 7 },
    ]);

    const [sql, organizationId, params] = mockedQuery.mock.calls[0];
    expect(sql).toContain("sum(bytes) AS bytes");
    expect(sql).toContain("sum(items) AS items");
    expect(sql).toMatch(
      /bucket >= toStartOfHour\(\s*parseDateTimeBestEffort\(\{from:String\}\),\s*'UTC'\s*\)/,
    );
    expect(sql).toMatch(
      /bucket < toStartOfHour\(\s*parseDateTimeBestEffort\(\{to:String\}\),\s*'UTC'\s*\)/,
    );
    expect(sql).toContain("GROUP BY meter");
    expect(sql).not.toContain("tenant_id");
    expect(organizationId).toBe("42");
    expect(params).toEqual(range);
  });

  it("ignores future meter values that the signal UI does not know", async () => {
    mockedQuery.mockResolvedValueOnce([
      { meter: "queries", bytes: "100", items: "1" },
      { meter: "metrics", bytes: "200", items: "2" },
    ]);

    await expect(getOrgUsage({ data: range })).resolves.toEqual([
      { meter: "metrics", bytes: 200, items: 2 },
    ]);
  });

  it("rejects an empty or reversed range before querying", async () => {
    await expect(
      getOrgUsage({ data: { from: range.to, to: range.from } }),
    ).rejects.toThrow(/end after it starts/i);
    await expect(
      getOrgUsage({ data: { from: "not-a-date", to: range.to } }),
    ).rejects.toThrow();

    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("rejects UInt64 results that cannot be represented safely", async () => {
    mockedQuery.mockResolvedValueOnce([
      { meter: "logs", bytes: "9007199254740992", items: "1" },
    ]);

    await expect(getOrgUsage({ data: range })).rejects.toThrow(
      /invalid clickhouse uint64 value for bytes/i,
    );
  });
});

describe("getOrgUsageSeries", () => {
  it("returns ordered UTC daily points with normalized counters", async () => {
    mockedQuery.mockResolvedValueOnce([
      {
        date: "2026-08-01",
        meter: "logs",
        bytes: "1000000000",
        items: "10",
      },
      {
        date: "2026-08-01",
        meter: "metrics",
        bytes: 250,
        items: 2,
      },
    ]);

    await expect(getOrgUsageSeries({ data: range })).resolves.toEqual([
      {
        date: "2026-08-01",
        meter: "logs",
        bytes: 1_000_000_000,
        items: 10,
      },
      {
        date: "2026-08-01",
        meter: "metrics",
        bytes: 250,
        items: 2,
      },
    ]);

    const [sql, organizationId, params] = mockedQuery.mock.calls[0];
    expect(sql).toContain("toDate(bucket, 'UTC')");
    expect(sql).toMatch(
      /bucket >= toStartOfHour\(\s*parseDateTimeBestEffort\(\{from:String\}\),\s*'UTC'\s*\)/,
    );
    expect(sql).toMatch(
      /bucket < toStartOfHour\(\s*parseDateTimeBestEffort\(\{to:String\}\),\s*'UTC'\s*\)/,
    );
    expect(sql).toContain("sum(bytes) AS bytes");
    expect(sql).toContain("sum(items) AS items");
    expect(sql).toContain("GROUP BY date, meter");
    expect(sql).toContain("ORDER BY date ASC, meter ASC");
    expect(sql).not.toContain("tenant_id");
    expect(organizationId).toBe("42");
    expect(params).toEqual(range);
  });
});
