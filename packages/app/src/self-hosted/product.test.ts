// @vitest-environment node

import { productPolicy } from "@app/policy";
import { beforeEach, expect, it, vi } from "vitest";
import { createOrganization } from "@/data/organizations";
import { auth } from "@/lib/auth.server";
import { assertCanInviteMembers } from "@/product/membership.server";

vi.mock("@polar-sh/sdk", () => {
  throw new Error("Self-hosting loaded Polar");
});
vi.mock("@/cloud/billing-data.server", () => {
  throw new Error("Self-hosting read subscription state");
});

beforeEach(() => vi.clearAllMocks());

it("permits collaboration independently of subscription state", async () => {
  expect(await productPolicy.forOrganization("org")).toMatchObject({
    access: "enabled",
    canInviteMembers: true,
  });
  await expect(assertCanInviteMembers("org")).resolves.toBeUndefined();
});

it("rejects additional organization creation", async () => {
  await expect(
    createOrganization({ data: { organizationName: "Acme" } }),
  ).rejects.toThrow("one workspace");
  expect(auth.api.createOrganization).not.toHaveBeenCalled();
});

it("rejects organization creation and deletion through authentication hooks", async () => {
  const { beforeCreateOrganization, identityLifecycle } = await import(
    "@app/auth"
  );
  await expect(beforeCreateOrganization()).rejects.toThrow("one workspace");
  await expect(identityLifecycle.assertDeletable("test_org")).rejects.toThrow(
    "cannot be deleted",
  );
});
