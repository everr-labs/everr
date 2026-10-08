import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/data/billing", () => ({
  getActiveOrgAppAccess: vi.fn().mockResolvedValue({ appState: "hobby" }),
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => new Headers(),
}));

import { auth } from "@/lib/auth.server";
import { Route } from "./_authenticated";

const beforeLoad = Route.options.beforeLoad as unknown as (args: {
  context: {
    session: {
      user: { id: string };
      session: { activeOrganizationId: string | null };
    } | null;
  };
  location: { pathname: string; href: string };
}) => Promise<unknown>;

function openApp(activeOrganizationId: string | null, pathname = "/logs") {
  return beforeLoad({
    context: {
      session: { user: { id: "test_user" }, session: { activeOrganizationId } },
    },
    location: { pathname, href: `${pathname}?service=api#results` },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getFullOrganization).mockResolvedValue({
    metadata: { clickhouseReady: true },
  } as never);
});

it("verifies membership before allowing app data pages", async () => {
  expect(await openApp("test_org")).toMatchObject({ clickhouseReady: true });
  expect(auth.api.getFullOrganization).toHaveBeenCalledWith({
    headers: new Headers(),
    query: { organizationId: "test_org" },
  });
});

it("redirects missing selection into the auth layout with the requested destination", async () => {
  await expect(openApp(null)).rejects.toMatchObject({
    options: {
      to: "/choose-organization",
      search: { returnTo: "/logs?service=api#results" },
      replace: true,
    },
  });
  expect(auth.api.getFullOrganization).not.toHaveBeenCalled();
});

it("redirects revoked membership to organization selection", async () => {
  vi.mocked(auth.api.getFullOrganization).mockRejectedValue(
    new Error("You are not a member"),
  );
  await expect(openApp("test_org")).rejects.toMatchObject({
    options: { to: "/choose-organization" },
  });
});

it("redirects pending organizations before their data pages load", async () => {
  vi.mocked(auth.api.getFullOrganization).mockResolvedValue({
    metadata: { clickhouseReady: false },
  } as never);
  await expect(openApp("test_org")).rejects.toMatchObject({
    options: {
      to: "/organization-setup",
      search: { returnTo: "/logs?service=api#results" },
      replace: true,
    },
  });
});

it("keeps account settings accessible without an organization", async () => {
  expect(await openApp(null, "/account")).toMatchObject({
    clickhouseReady: true,
  });
  expect(auth.api.getFullOrganization).not.toHaveBeenCalled();
});

it("does not turn an infrastructure failure into an onboarding redirect", async () => {
  vi.mocked(auth.api.getFullOrganization).mockRejectedValue(
    new Error("Organization database unavailable"),
  );
  await expect(openApp("test_org")).rejects.toThrow("database unavailable");
});

it("preserves the CLI approval destination when sending unauthenticated users to signup", async () => {
  await expect(
    beforeLoad({
      context: { session: null },
      location: { pathname: "/device", href: "/device?user_code=ABCD" },
    }),
  ).rejects.toMatchObject({
    options: {
      to: "/auth/sign-up",
      search: { redirect: "/device?user_code=ABCD" },
    },
  });
});
