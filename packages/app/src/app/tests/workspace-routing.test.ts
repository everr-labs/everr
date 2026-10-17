import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/data/organization-access", () => ({
  getActiveOrganizationAccess: vi.fn(),
}));

import { Route } from "@/app/routes/_welcome/_signedIn/access-required";
import { getActiveOrganizationAccess } from "@/data/organization-access";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationAccess).mockResolvedValue({
    status: "missing",
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
