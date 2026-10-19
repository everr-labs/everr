// @vitest-environment node
import { expect, it } from "vitest";

it("rejects organization creation and deletion through authentication hooks", async () => {
  const { identity } = await import("@composition/identity");
  const { organizationHooks, identityLifecycle } = identity;
  await expect(organizationHooks().beforeCreateOrganization()).rejects.toThrow(
    "one workspace",
  );
  await expect(identityLifecycle.assertDeletable("test_org")).rejects.toThrow(
    "cannot be deleted",
  );
});
