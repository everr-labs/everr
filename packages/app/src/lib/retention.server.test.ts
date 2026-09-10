import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/billing-data.server", () => ({
  readOrgEntitlement: vi.fn(),
}));

import { readOrgEntitlement } from "@/lib/billing-data.server";
import { retentionForOrg } from "./retention.server";

const entitlement = {
  status: "active",
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

describe("retentionForOrg", () => {
  beforeEach(() => {
    vi.mocked(readOrgEntitlement).mockClear();
  });

  it.each([
    {
      tier: "free" as const,
      telemetryDays: 14,
      evaluationDays: 14,
      lifecycleDays: 14,
    },
    {
      tier: "pro" as const,
      telemetryDays: 365,
      evaluationDays: 30,
      lifecycleDays: 365,
    },
  ])("returns the $tier entitlements", async ({
    tier,
    telemetryDays,
    evaluationDays,
    lifecycleDays,
  }) => {
    vi.mocked(readOrgEntitlement).mockResolvedValueOnce({
      ...entitlement,
      tier,
    });

    await expect(retentionForOrg(`org_${tier}`)).resolves.toEqual({
      tracesDays: telemetryDays,
      logsDays: telemetryDays,
      metricsDays: telemetryDays,
      alertEvaluationDays: evaluationDays,
      alertLifecycleDays: lifecycleDays,
    });
  });

  it("answers a repeated lookup without asking the database again", async () => {
    vi.mocked(readOrgEntitlement).mockResolvedValueOnce({
      ...entitlement,
      tier: "free",
    });

    const first = await retentionForOrg("org_cached");
    const second = await retentionForOrg("org_cached");

    expect(second).toEqual(first);
    expect(vi.mocked(readOrgEntitlement)).toHaveBeenCalledTimes(1);
  });
});
