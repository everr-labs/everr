import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@/lib/clickhouse", () => ({ query: mocks.query }));

import {
  alertingChannelHealthWindowStart,
  queryClickHouseChannelHealth,
} from "./health-repository.server";

const from = new Date("2026-06-16T00:00:00Z");

beforeEach(() => {
  mocks.query.mockReset().mockResolvedValue([]);
});

describe("queryClickHouseChannelHealth", () => {
  it("counts deliveries, not the alert-event rows they carried", async () => {
    await queryClickHouseChannelHealth("org-1", { from });

    const [sql, organizationId, params] = mocks.query.mock.calls[0];
    expect(sql).toContain(
      "event_type IN ('delivery_succeeded', 'delivery_failed')",
    );
    expect(sql).toContain("uniqExactIf(delivery_dedup_key, succeeded)");
    expect(sql).toContain("AND is_live");
    expect(organizationId).toBe("org-1");
    expect(params).toMatchObject({
      organizationId: "org-1",
      from: "2026-06-16 00:00:00.000",
    });
  });

  it("reports a timestamp only for an outcome that happened", async () => {
    // maxIf over no matching row yields the epoch, which would otherwise read
    // as a delivery in 1970.
    mocks.query.mockResolvedValue([
      {
        channel: "team-slack",
        delivered: "3",
        failed: "0",
        lastSuccessAt: "2026-06-16T10:00:00.000Z",
        lastFailureAt: "1970-01-01T00:00:00.000Z",
        lastError: "",
      },
    ]);

    const [health] = await queryClickHouseChannelHealth("org-1", { from });

    expect(health).toEqual({
      channel: "team-slack",
      delivered: 3,
      failed: 0,
      lastSuccessAt: "2026-06-16T10:00:00.000Z",
      lastFailureAt: null,
      lastError: "",
    });
  });
});

describe("alertingChannelHealthWindowStart", () => {
  it("looks back one day", () => {
    expect(
      alertingChannelHealthWindowStart(
        new Date("2026-06-16T12:00:00Z"),
      ).toISOString(),
    ).toBe("2026-06-15T12:00:00.000Z");
  });
});
