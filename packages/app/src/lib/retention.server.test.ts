import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/billing-data.server", () => ({
  readOrgEntitlement: vi.fn(),
}));

import { readOrgEntitlement } from "@/lib/billing-data.server";
import { resolveRetention } from "@/lib/retention";
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

  it("returns the retention of the organization's tier", async () => {
    vi.mocked(readOrgEntitlement).mockResolvedValueOnce({
      ...entitlement,
      tier: "pro",
    });

    await expect(retentionForOrg("org_pro")).resolves.toEqual(
      resolveRetention("pro"),
    );
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
