// @vitest-environment node

import { product } from "@composition/product";
import { beforeEach, expect, it, vi } from "vitest";
import { assertCanInviteMembers } from "@/product/membership.server";

beforeEach(() => vi.clearAllMocks());

it("permits workspace collaboration", async () => {
  expect(await product.forOrganization("org")).toMatchObject({
    access: "enabled",
    canInviteMembers: true,
  });
  await expect(assertCanInviteMembers("org")).resolves.toBeUndefined();
});

it("rejects organization creation and deletion through authentication hooks", async () => {
  const { server } = await import("@composition/server");
  const { organizationHooks, identityLifecycle } = await server.loadIdentity();
  await expect(organizationHooks().beforeCreateOrganization()).rejects.toThrow(
    "one workspace",
  );
  await expect(identityLifecycle.assertDeletable("test_org")).rejects.toThrow(
    "cannot be deleted",
  );
});
