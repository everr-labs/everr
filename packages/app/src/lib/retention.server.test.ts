import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/billing-data.server", () => ({
  readOrgEntitlement: vi.fn(),
}));

import { readOrgEntitlement } from "@/lib/billing-data.server";
import { resolveRetention } from "@/lib/retention";
import { retentionForOrg } from "./retention.server";

describe("retentionForOrg", () => {
  it("returns the retention of the organization's tier", async () => {
    vi.mocked(readOrgEntitlement).mockResolvedValueOnce({
      tier: "pro",
      status: "active",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });

    await expect(retentionForOrg("org_42")).resolves.toEqual(
      resolveRetention("pro"),
    );
    expect(readOrgEntitlement).toHaveBeenCalledWith("org_42");
  });
});
