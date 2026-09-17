import { describe, expect, it, vi } from "vitest";

const selectLimit = vi.fn();

vi.mock("@/env", () => ({
  env: {
    POLAR_PRO_PRODUCT_ID: "product_pro",
    POLAR_PRO_LEGACY_PRODUCT_IDS: undefined,
  },
}));

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: selectLimit }) }),
    }),
  },
}));

import { readOrgEntitlement } from "./billing-data.server";

const IN_THE_PERIOD = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

function subscription(
  row: {
    polarProductId?: string;
    status: string;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
  },
  plan: "hobby" | "pro" = "pro",
) {
  selectLimit.mockResolvedValueOnce([{ plan }]);
  selectLimit.mockResolvedValueOnce([
    { polarProductId: "product_pro", ...row },
  ]);
  return readOrgEntitlement("org42");
}

describe("readOrgEntitlement", () => {
  it("gives an active subscription the Pro plan", async () => {
    const entitlement = await subscription({
      status: "active",
      currentPeriodEnd: IN_THE_PERIOD,
      cancelAtPeriodEnd: false,
    });

    expect(entitlement.plan).toBe("pro");
  });

  it("suspends Pro as soon as payment is past due", async () => {
    const entitlement = await subscription({
      status: "past_due",
      currentPeriodEnd: IN_THE_PERIOD,
      cancelAtPeriodEnd: false,
    });

    expect(entitlement.appState).toBe("suspended");
    expect(entitlement.plan).toBe("pro");
  });

  it("does not grant Pro during a trial", async () => {
    const entitlement = await subscription({
      status: "trialing",
      currentPeriodEnd: IN_THE_PERIOD,
      cancelAtPeriodEnd: false,
    });

    expect(entitlement.appState).toBe("suspended");
    expect(entitlement.plan).toBe("pro");
  });

  it("keeps Pro for an active subscription scheduled to cancel", async () => {
    const entitlement = await subscription({
      status: "active",
      currentPeriodEnd: IN_THE_PERIOD,
      cancelAtPeriodEnd: true,
    });

    expect(entitlement.appState).toBe("pro");
    expect(entitlement.plan).toBe("pro");
  });

  it("keeps Hobby when an old subscription is inactive", async () => {
    const entitlement = await subscription(
      {
        status: "canceled",
        currentPeriodEnd: IN_THE_PERIOD,
        cancelAtPeriodEnd: false,
      },
      "hobby",
    );

    expect(entitlement.appState).toBe("hobby");
    expect(entitlement.plan).toBe("hobby");
  });

  it("gives an org with no subscription the Hobby plan", async () => {
    selectLimit.mockResolvedValueOnce([{ plan: "hobby" }]);
    selectLimit.mockResolvedValueOnce([]);

    const entitlement = await readOrgEntitlement("org42");

    expect(entitlement.plan).toBe("hobby");
    expect(entitlement.appState).toBe("hobby");
    expect(entitlement.status).toBeNull();
  });

  it("throws when the persisted subscription references an unknown Product", async () => {
    await expect(
      subscription({
        polarProductId: "product_unknown",
        status: "active",
        currentPeriodEnd: IN_THE_PERIOD,
        cancelAtPeriodEnd: false,
      }),
    ).rejects.toThrow(
      "Polar Product product_unknown is not configured for this deployment",
    );
  });
});
