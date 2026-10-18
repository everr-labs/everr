// @vitest-environment node
import { expect, it } from "vitest";

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
