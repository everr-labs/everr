import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/data/organization-access", () => ({
  getActiveOrganizationAccess: vi.fn(),
}));
vi.mock("@/data/product", () => ({ getActiveOrgPolicy: vi.fn() }));

import { Route } from "@/app/routes/_welcome/_signedIn/access-required";
import { getActiveOrganizationAccess } from "@/data/organization-access";
import { requireOrganization } from "@/lib/route-access";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationAccess).mockResolvedValue({
    status: "missing",
  });
});

it.each([
  null,
  "revoked-workspace",
])("sends missing workspace access (%s) to the access page", async (activeOrganizationId) => {
  await expect(
    requireOrganization({
      context: {
        session: {
          user: { id: "user" },
          session: { activeOrganizationId },
        } as never,
      },
      location: { href: "/logs?service=api#results" },
      search: {},
    }),
  ).rejects.toMatchObject({
    options: {
      to: "/access-required",
      search: { returnTo: "/logs?service=api#results" },
      replace: true,
    },
  });
});

const openAccessPage = () =>
  (Route.options.beforeLoad as (args: unknown) => unknown)({
    search: { returnTo: "/logs?service=api#results" },
  });

it("keeps users without membership on the access page", async () => {
  await expect(openAccessPage()).resolves.toBeUndefined();
});

it("returns members to their destination once access is available", async () => {
  vi.mocked(getActiveOrganizationAccess).mockResolvedValue({
    status: "available",
    organization: { id: "workspace", metadata: null },
  });
  await expect(openAccessPage()).rejects.toMatchObject({
    options: { href: "/logs?service=api#results", replace: true },
  });
});
