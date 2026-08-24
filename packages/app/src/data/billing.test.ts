import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readOrgEntitlement: vi.fn(),
}));

vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({ organization: {} }));
vi.mock("@/env", () => ({
  env: {
    BETTER_AUTH_URL: "http://localhost:3000",
    POLAR_PRO_PRODUCT_ID: "product_pro",
  },
}));
vi.mock("@/lib/billing-data.server", () => ({
  readOrgEntitlement: mocks.readOrgEntitlement,
}));
vi.mock("@/lib/polar.server", () => ({
  ensurePolarCustomerForOrg: vi.fn(),
  polarClient: {
    checkouts: { create: vi.fn() },
    customerSessions: { create: vi.fn() },
  },
}));

import { getOrgEntitlement } from "./billing";

afterEach(() => {
  vi.useRealTimers();
});

describe("getOrgEntitlement", () => {
  it("attaches the trusted server time to the entitlement snapshot", async () => {
    const serverNow = new Date("2026-09-01T00:00:00.123Z");
    vi.useFakeTimers();
    vi.setSystemTime(serverNow);
    mocks.readOrgEntitlement.mockResolvedValue({
      tier: "free",
      status: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });

    await expect(getOrgEntitlement()).resolves.toEqual({
      tier: "free",
      status: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      serverNow: serverNow.toISOString(),
    });
    expect(mocks.readOrgEntitlement).toHaveBeenCalledWith("test_org");
  });
});
