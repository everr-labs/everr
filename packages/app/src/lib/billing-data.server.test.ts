import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const onConflictDoUpdate = vi.fn();
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values }));
  const limit = vi.fn();
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return {
    from,
    insert,
    limit,
    onConflictDoUpdate,
    orgSubscription: {
      orgId: Symbol("orgId"),
      polarModifiedAt: Symbol("polarModifiedAt"),
      status: Symbol("status"),
    },
    select,
    upsertTenantRetention: vi.fn(),
    values,
    where,
  };
});

vi.mock("@/db/client", () => ({
  db: {
    insert: mocks.insert,
    select: mocks.select,
  },
}));

vi.mock("@/db/schema", () => ({ orgSubscription: mocks.orgSubscription }));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => Symbol("where")),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
}));

vi.mock("@/lib/clickhouse", () => ({
  upsertTenantRetention: mocks.upsertTenantRetention,
}));

import {
  readOrgEntitlement,
  upsertOrgSubscription,
} from "./billing-data.server";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.onConflictDoUpdate.mockResolvedValue(undefined);
  mocks.upsertTenantRetention.mockResolvedValue(undefined);
});

describe("readOrgEntitlement", () => {
  it("returns the exact persisted subscription period", async () => {
    const currentPeriodStart = new Date("2026-08-17T14:35:12.000Z");
    const currentPeriodEnd = new Date("2026-09-17T14:35:12.000Z");
    mocks.limit.mockResolvedValueOnce([
      {
        status: "active",
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: true,
      },
    ]);

    await expect(readOrgEntitlement("org_42")).resolves.toEqual({
      tier: "pro",
      status: "active",
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: true,
    });
  });

  it("returns Free defaults when no subscription exists", async () => {
    mocks.limit.mockResolvedValueOnce([]);

    await expect(readOrgEntitlement("org_42")).resolves.toEqual({
      tier: "free",
      status: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
  });
});

describe("upsertOrgSubscription", () => {
  it("persists both period bounds and syncs Pro retention", async () => {
    const currentPeriodStart = new Date("2026-08-17T14:35:12.000Z");
    const currentPeriodEnd = new Date("2026-09-17T14:35:12.000Z");
    const input = {
      orgId: "org_42",
      polarSubscriptionId: "sub_42",
      polarProductId: "product_pro",
      status: "active",
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
      polarModifiedAt: new Date("2026-08-17T14:35:13.000Z"),
    };
    mocks.limit.mockResolvedValueOnce([{ status: "active" }]);

    await upsertOrgSubscription(input);

    expect(mocks.values).toHaveBeenCalledWith(input);
    expect(mocks.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: mocks.orgSubscription.orgId,
        set: expect.objectContaining({
          currentPeriodStart,
          currentPeriodEnd,
        }),
        setWhere: expect.anything(),
      }),
    );
    expect(mocks.upsertTenantRetention).toHaveBeenCalledWith({
      tenantId: "org_42",
      tracesDays: 90,
      logsDays: 90,
      metricsDays: 395,
    });
  });

  it("preserves null bounds and uses persisted state after a stale retry", async () => {
    const input = {
      orgId: "org_42",
      polarSubscriptionId: "sub_42",
      polarProductId: "product_pro",
      status: "active",
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      polarModifiedAt: new Date("2026-08-17T14:35:13.000Z"),
    };
    mocks.limit.mockResolvedValueOnce([{ status: "canceled" }]);

    await upsertOrgSubscription(input);

    expect(mocks.values).toHaveBeenCalledWith(input);
    expect(mocks.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          currentPeriodStart: null,
          currentPeriodEnd: null,
        }),
      }),
    );
    expect(mocks.upsertTenantRetention).toHaveBeenCalledWith({
      tenantId: "org_42",
      tracesDays: 7,
      logsDays: 7,
      metricsDays: 14,
    });
  });
});
