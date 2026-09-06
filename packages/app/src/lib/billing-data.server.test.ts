import { describe, expect, it, vi } from "vitest";

const selectLimit = vi.fn();

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: selectLimit }) }),
    }),
  },
}));

import { readOrgEntitlement } from "./billing-data.server";

const IN_THE_PERIOD = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const PERIOD_OVER = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

function subscription(row: {
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}) {
  selectLimit.mockResolvedValueOnce([row]);
  return readOrgEntitlement("org42");
}

describe("readOrgEntitlement", () => {
  it("gives an active subscription the pro tier", async () => {
    const entitlement = await subscription({
      status: "active",
      currentPeriodEnd: IN_THE_PERIOD,
      cancelAtPeriodEnd: false,
    });

    expect(entitlement.tier).toBe("pro");
  });

  it("keeps pro while a failed payment is retried inside the paid period", async () => {
    const entitlement = await subscription({
      status: "past_due",
      currentPeriodEnd: IN_THE_PERIOD,
      cancelAtPeriodEnd: false,
    });

    expect(entitlement.tier).toBe("pro");
  });

  it("drops to free once the paid period is over", async () => {
    const entitlement = await subscription({
      status: "past_due",
      currentPeriodEnd: PERIOD_OVER,
      cancelAtPeriodEnd: false,
    });

    expect(entitlement.tier).toBe("free");
  });

  it("keeps pro until the period end for a cancellation scheduled there", async () => {
    const entitlement = await subscription({
      status: "canceled",
      currentPeriodEnd: IN_THE_PERIOD,
      cancelAtPeriodEnd: true,
    });

    expect(entitlement.tier).toBe("pro");
  });

  it("ends pro immediately for a revoked subscription", async () => {
    const entitlement = await subscription({
      status: "canceled",
      currentPeriodEnd: IN_THE_PERIOD,
      cancelAtPeriodEnd: false,
    });

    expect(entitlement.tier).toBe("free");
  });

  it("gives an org with no subscription the free tier", async () => {
    selectLimit.mockResolvedValueOnce([]);

    const entitlement = await readOrgEntitlement("org42");

    expect(entitlement.tier).toBe("free");
    expect(entitlement.status).toBeNull();
  });
});
