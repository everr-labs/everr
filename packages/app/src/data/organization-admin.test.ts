import { QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vite-plus/test";
import { organizationAccessKey, routeAccessQuery } from "#app/lib/route-access-cache.ts";
import { requireOrganizationAdmin } from "./organization-admin";

const session = { session: { id: "session-1", activeOrganizationId: "org-1" } };

async function cachedAsMember(currentRole: string) {
  const queryClient = new QueryClient();
  const access = vi
    .fn()
    .mockResolvedValueOnce({ status: "available", memberRole: "member" })
    .mockResolvedValueOnce({ status: "available", memberRole: currentRole });
  await queryClient.ensureQueryData(routeAccessQuery(organizationAccessKey(session), access));
  return { memberRole: "member", session, queryClient };
}

it("lets in a member promoted to admin since their role was cached", async () => {
  const context = await cachedAsMember("admin");

  expect(await requireOrganizationAdmin({ context })).toEqual({ memberRole: "admin" });
});

it("refuses a member who is still a member", async () => {
  const context = await cachedAsMember("member");

  await expect(requireOrganizationAdmin({ context })).rejects.toThrow("Not authorized");
});
