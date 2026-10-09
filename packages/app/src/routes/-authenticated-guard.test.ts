import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/data/organization-access", () => ({
  getActiveOrganizationAccess: vi.fn(),
}));
vi.mock("@/data/billing", () => ({ getActiveOrgAppAccess: vi.fn() }));

import { getActiveOrgAppAccess } from "@/data/billing";
import { getActiveOrganizationAccess } from "@/data/organization-access";
import { Route as sessionRoute } from "./_authenticated";
import { Route as organizationRoute } from "./_authenticated/_organization";
import { Route as accessRoute } from "./_authenticated/_organization/_dashboard/_appAccess";
import { Route as provisionedRoute } from "./_authenticated/_organization/_dashboard/_appAccess/_provisioned";

function open(
  route: { options: unknown },
  activeOrganizationId: string | null,
  createdOrganizationId: string | null = null,
) {
  const beforeLoad = (
    route.options as { beforeLoad: (args: unknown) => unknown }
  ).beforeLoad;
  return Promise.resolve().then(() =>
    beforeLoad({
      context: {
        session: {
          user: { id: "test_user" },
          session: { activeOrganizationId },
        },
        createdOrganizationId,
        organization: { id: "test_org", metadata: { clickhouseReady: false } },
      },
      search: {},
      location: { href: "/logs?service=api#results" },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationAccess).mockResolvedValue({
    status: "available",
    organization: { id: "test_org", metadata: '{"clickhouseReady":true}' },
  });
  vi.mocked(getActiveOrgAppAccess).mockResolvedValue({
    appState: "hobby",
  } as never);
});

it("admits signed-in account users without selecting an organization", async () => {
  expect(await open(sessionRoute, null)).toMatchObject({
    session: { session: { activeOrganizationId: null } },
  });
  expect(getActiveOrganizationAccess).not.toHaveBeenCalled();
});
it("verifies membership before passing organization context to descendants", async () => {
  expect(await open(organizationRoute, "test_org")).toMatchObject({
    organization: { id: "test_org" },
  });
  expect(getActiveOrganizationAccess).toHaveBeenCalledOnce();
});
it("preserves the original destination when organization selection is missing", async () => {
  await expect(open(organizationRoute, null)).rejects.toMatchObject({
    options: {
      to: "/choose-organization",
      search: { returnTo: "/logs?service=api#results" },
      replace: true,
    },
  });
  expect(getActiveOrganizationAccess).not.toHaveBeenCalled();
});
it("redirects revoked membership using the structured result", async () => {
  vi.mocked(getActiveOrganizationAccess).mockResolvedValue({
    status: "missing",
  });
  await expect(open(organizationRoute, "test_org")).rejects.toMatchObject({
    options: { to: "/choose-organization" },
  });
});
it("shows creation setup even when the new organization is already ready", async () => {
  await expect(
    open(organizationRoute, "test_org", "test_org"),
  ).rejects.toMatchObject({
    options: {
      to: "/organization-setup",
      search: { returnTo: "/logs?service=api#results" },
    },
  });
});
it("does not apply a different organization's creation continuation", async () => {
  await expect(
    open(organizationRoute, "test_org", "other_org"),
  ).resolves.toMatchObject({ organization: { id: "test_org" } });
});
it("uses recovery instead of creation onboarding for an existing pending organization", async () => {
  await expect(open(provisionedRoute, "test_org")).rejects.toMatchObject({
    options: {
      to: "/organization-pending",
      search: { returnTo: "/logs?service=api#results" },
      replace: true,
    },
  });
});
it("routes suspended app access to billing recovery", async () => {
  vi.mocked(getActiveOrgAppAccess).mockResolvedValue({
    appState: "suspended",
  } as never);
  await expect(open(accessRoute, "test_org")).rejects.toMatchObject({
    options: { to: "/billing/suspended" },
  });
});
it("keeps infrastructure errors visible", async () => {
  vi.mocked(getActiveOrganizationAccess).mockRejectedValue(
    new Error("Organization database unavailable"),
  );
  await expect(open(organizationRoute, "test_org")).rejects.toThrow(
    "database unavailable",
  );
});
it("preserves device approval through signup using the route's auth preference", async () => {
  const beforeLoad = sessionRoute.options.beforeLoad as (
    args: never,
  ) => unknown;
  expect(() =>
    beforeLoad({
      context: { session: null },
      location: { href: "/device?user_code=ABCD" },
      matches: [{ staticData: { authEntry: "/auth/sign-up" } }],
    } as never),
  ).toThrow();
  try {
    beforeLoad({
      context: { session: null },
      location: { href: "/device?user_code=ABCD" },
      matches: [{ staticData: { authEntry: "/auth/sign-up" } }],
    } as never);
  } catch (error) {
    expect(error).toMatchObject({
      options: {
        to: "/auth/sign-up",
        search: { redirect: "/device?user_code=ABCD" },
      },
    });
  }
});
