import { describe, expect, it, vi } from "vitest";

vi.mock("@/cloud/billing-data.server", () => ({ readOrgEntitlement: vi.fn() }));

import { productPolicy } from "@/cloud/app/policy";
import { readOrgEntitlement } from "@/cloud/billing-data.server";
import { retentionForDays } from "@/product/retention.test-fixtures";

describe("cloud retention", () => {
  it.each([
    ["hobby", "hobby", retentionForDays(14)],
    ["pro", "pro", retentionForDays(365, 30)],
    ["pro", "suspended", retentionForDays(365, 30)],
  ] as const)("preserves %s retention with %s access", async (plan, appState, retention) => {
    vi.mocked(readOrgEntitlement).mockResolvedValueOnce({
      plan,
      appState,
      status: "active",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
    expect((await productPolicy.forOrganization("org")).retention).toEqual(
      retention,
    );
  });
});
