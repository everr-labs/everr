// @vitest-environment node
import { expect, it, vi } from "vitest";

vi.mock("@/cloud/billing-data.server", () => ({ readOrgEntitlement: vi.fn() }));

import { readOrgEntitlement } from "@/cloud/billing-data.server";
import { assertCanInviteMembers } from "./membership.server";

it.each([
  "hobby",
  "suspended",
] as const)("preserves Cloud's collaboration restriction for %s organizations", async (appState) => {
  vi.mocked(readOrgEntitlement).mockResolvedValue({
    plan: appState === "hobby" ? "hobby" : "pro",
    appState,
    status: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  });
  await expect(assertCanInviteMembers("org")).rejects.toMatchObject({
    status: "FORBIDDEN",
  });
});

it("allows members for an active Cloud subscription", async () => {
  vi.mocked(readOrgEntitlement).mockResolvedValue({
    plan: "pro",
    appState: "pro",
    status: "active",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  });
  await expect(assertCanInviteMembers("org")).resolves.toBeUndefined();
});

it("does not grant collaboration if subscription state cannot be read", async () => {
  vi.mocked(readOrgEntitlement).mockRejectedValue(
    new Error("Database unavailable"),
  );
  await expect(assertCanInviteMembers("org")).rejects.toThrow(
    "Database unavailable",
  );
});
